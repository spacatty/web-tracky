package server

import (
	"context"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"tracky/api/internal/config"
	"tracky/api/internal/pack"
)

type Server struct {
	cfg        config.Config
	pool       *pgxpool.Pool
	packs      *pack.Cache
	broker     *Broker
	waker      *Waker
	enrollHits *limiter
	dummyHash  []byte
	manifestMu sync.Mutex
	manifestAt time.Time
	manifest   releaseManifest
}

func New(cfg config.Config, pool *pgxpool.Pool) *Server {
	dummy, _ := bcrypt.GenerateFromPassword([]byte("tracky-invalid-password"), bcrypt.DefaultCost)
	return &Server{
		cfg:        cfg,
		pool:       pool,
		packs:      pack.NewCache(cfg.PackPath),
		broker:     newBroker(),
		waker:      newWaker(),
		enrollHits: &limiter{},
		dummyHash:  dummy,
	}
}

func (s *Server) Init(ctx context.Context) error {
	if strings.Contains(s.cfg.SessionSecret, "change-me") {
		log.Printf("warning: SESSION_SECRET is still a development placeholder")
	}
	if _, _, err := s.syncPack(ctx); err != nil {
		return err
	}
	if err := s.bootstrap(ctx); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO groups (name, slug, visibility, description)
		VALUES ('Public', 'public', 'public', 'Shared pool every signed-in user can check from')
		ON CONFLICT (slug) DO NOTHING`)
	return err
}

func (s *Server) bootstrap(ctx context.Context) error {
	if s.cfg.BootstrapEmail == "" || s.cfg.BootstrapPassword == "" {
		return nil
	}
	if err := validatePassword(s.cfg.BootstrapPassword); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(s.cfg.BootstrapPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO users (email, password_hash, role)
		VALUES ($1, $2, 'admin')
		ON CONFLICT (email) DO UPDATE
		SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
		s.cfg.BootstrapEmail, string(hash))
	if err != nil {
		return err
	}
	log.Printf("bootstrap admin ready: %s", s.cfg.BootstrapEmail)
	return nil
}

func (s *Server) syncPack(ctx context.Context) (pack.Document, []byte, error) {
	doc, raw, err := s.packs.Load()
	if err != nil {
		return doc, nil, err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO instruction_packs (version, core_min, document)
		VALUES ($1, $2, $3::jsonb)
		ON CONFLICT (version) DO UPDATE
		SET core_min = EXCLUDED.core_min, document = EXCLUDED.document`,
		doc.Version, doc.CoreMin, raw)
	return doc, raw, err
}

func (s *Server) offlineAfter(ctx context.Context) int {
	doc, _, err := s.packs.Load()
	if err != nil || doc.HeartbeatSec <= 0 {
		return 45
	}
	return doc.HeartbeatSec * 3
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /api/config", s.publicConfig)

	mux.HandleFunc("POST /api/auth/register", s.register)
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.HandleFunc("POST /api/auth/logout", s.logout)
	mux.HandleFunc("GET /api/auth/me", s.requireUser(s.me))
	mux.HandleFunc("GET /api/overview", s.requireUser(s.overview))

	mux.HandleFunc("GET /api/users", s.requireAdmin(s.listUsers))
	mux.HandleFunc("POST /api/users", s.requireAdmin(s.createUser))
	mux.HandleFunc("PATCH /api/users/{id}", s.requireAdmin(s.patchUser))
	mux.HandleFunc("DELETE /api/users/{id}", s.requireAdmin(s.deleteUser))

	mux.HandleFunc("GET /api/groups", s.requireUser(s.listGroups))
	mux.HandleFunc("POST /api/groups", s.requireAdmin(s.createGroup))
	mux.HandleFunc("GET /api/groups/{id}", s.requireUser(s.getGroup))
	mux.HandleFunc("PATCH /api/groups/{id}", s.requireAdmin(s.patchGroup))
	mux.HandleFunc("DELETE /api/groups/{id}", s.requireAdmin(s.deleteGroup))

	mux.HandleFunc("GET /api/nodes", s.requireUser(s.listNodes))
	mux.HandleFunc("GET /api/nodes/{id}", s.requireUser(s.getNode))
	mux.HandleFunc("GET /api/nodes/{id}/metrics", s.requireUser(s.nodeMetrics))
	mux.HandleFunc("PATCH /api/nodes/{id}", s.requireAdmin(s.patchNode))
	mux.HandleFunc("DELETE /api/nodes/{id}", s.requireAdmin(s.deleteNode))

	mux.HandleFunc("GET /api/enroll-tokens", s.requireAdmin(s.listTokens))
	mux.HandleFunc("POST /api/enroll-tokens", s.requireAdmin(s.createToken))
	mux.HandleFunc("DELETE /api/enroll-tokens/{id}", s.requireAdmin(s.revokeToken))

	mux.HandleFunc("GET /api/monitors", s.requireUser(s.listMonitors))
	mux.HandleFunc("POST /api/monitors", s.requireUser(s.createMonitor))
	mux.HandleFunc("GET /api/monitors/{id}", s.requireUser(s.getMonitor))
	mux.HandleFunc("PATCH /api/monitors/{id}", s.requireUser(s.patchMonitor))
	mux.HandleFunc("DELETE /api/monitors/{id}", s.requireUser(s.deleteMonitor))
	mux.HandleFunc("POST /api/monitors/{id}/check", s.requireUser(s.checkNow))
	mux.HandleFunc("GET /api/public/status/{slug}", s.publicStatus)
	mux.HandleFunc("GET /api/stream", s.stream)

	mux.HandleFunc("GET /install.sh", s.installScript)
	mux.HandleFunc("POST /agent/v1/enroll", s.enroll)
	mux.HandleFunc("POST /agent/v1/heartbeat", s.heartbeat)
	mux.HandleFunc("POST /agent/v1/results", s.postResult)
	mux.HandleFunc("GET /agent/v1/manifest", s.manifestHTTP)
	mux.HandleFunc("GET /agent/v1/download/{goos}/{goarch}", s.downloadCurrent)
	mux.HandleFunc("GET /agent/v1/download/{goos}/{goarch}/sha256", s.downloadSHA)
	mux.HandleFunc("GET /agent/v1/releases/{version}/{goos}/{goarch}", s.downloadVersion)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("panic: %v", rec)
				writeErr(w, http.StatusInternalServerError, "internal error")
			}
		}()
		mux.ServeHTTP(w, r)
	})
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.pool.Ping(ctx); err != nil {
		writeErr(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) publicConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"registration":     s.cfg.Registration,
		"app_url":          s.cfg.AppPublicURL,
		"agent_url":        s.cfg.AgentPublicURL,
		"min_interval_sec": s.cfg.MinCheckIntervalSec,
	})
}

func (s *Server) requireUser(next func(http.ResponseWriter, *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := s.userFromRequest(r)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(w, r.WithContext(withUser(r.Context(), u)))
	}
}

func (s *Server) requireAdmin(next func(http.ResponseWriter, *http.Request)) http.HandlerFunc {
	return s.requireUser(func(w http.ResponseWriter, r *http.Request) {
		if !currentUser(r.Context()).Admin() {
			writeErr(w, http.StatusForbidden, "forbidden")
			return
		}
		next(w, r)
	})
}

type limiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func (l *limiter) allow(key string, limit int, window time.Duration) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.hits == nil {
		l.hits = map[string][]time.Time{}
	}
	prev := l.hits[key]
	kept := make([]time.Time, 0, len(prev)+1)
	for _, t := range prev {
		if now.Sub(t) < window {
			kept = append(kept, t)
		}
	}
	if len(kept) >= limit {
		l.hits[key] = kept
		return false
	}
	l.hits[key] = append(kept, now)
	return true
}
