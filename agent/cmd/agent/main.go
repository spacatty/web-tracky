package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"tracky/agent/internal/config"
	"tracky/agent/internal/interp"
	"tracky/agent/internal/update"
)

var version = "0.2.0"

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("agent ")
	path := os.Getenv("TRACKY_CONFIG")
	if path == "" {
		if runtime.GOOS == "windows" {
			path = filepath.Join(".", "tracky-agent.json")
		} else {
			path = "/etc/tracky-agent/config.json"
		}
	}
	if len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-") {
		path = os.Args[1]
	}
	cfg, err := config.Load(path)
	if err != nil {
		log.Fatal(err)
	}
	agent := &app{
		cfg:     cfg,
		cfgPath: path,
		engine:  interp.New(version),
		client:  &http.Client{Timeout: 90 * time.Second},
		pack:    config.LoadPack(config.StateDir(path)),
	}
	if cfg.NodeID == "" {
		if err := agent.enroll(context.Background()); err != nil {
			log.Fatal(err)
		}
	}
	agent.loop()
}

type app struct {
	cfg        config.File
	cfgPath    string
	engine     *interp.Engine
	client     *http.Client
	pack       config.Pack
	rtt        time.Duration
	forceSpeed bool
}

type heartbeatResponse struct {
	HeldMS         int64           `json:"held_ms"`
	HeartbeatSec   int             `json:"heartbeat_sec"`
	Core           update.Core     `json:"core"`
	Pack           json.RawMessage `json:"pack"`
	Jobs           []interp.Job    `json:"jobs"`
	RefreshMetrics bool            `json:"refresh_metrics"`
}

func (a *app) loop() {
	for {
		resp, rtt, err := a.heartbeat(context.Background())
		if err != nil {
			log.Printf("heartbeat: %v", err)
			time.Sleep(5 * time.Second)
			continue
		}
		a.rtt = rtt
		if resp.RefreshMetrics {
			a.forceSpeed = true
		}
		a.applyPack(resp.Pack)
		for _, job := range resp.Jobs {
			go a.runJob(job)
		}
		if len(resp.Jobs) == 0 && resp.Core.URL != "" && resp.Core.SHA256 != "" && resp.Core.Version != "" && resp.Core.Version != version {
			target := resp.Core.Version
			log.Printf("updating core %s -> %s", version, target)
			err := update.Apply(resp.Core.URL, resp.Core.SHA256, func(phase string, progress int) {
				a.reportUpdate(phase, target, "", progress)
			})
			if err != nil {
				log.Printf("core update failed: %v", err)
				a.reportUpdate("failed", target, err.Error(), 0)
			}
		}
		time.Sleep(time.Second)
	}
}

type enrollStatusError struct {
	status int
	body   string
}

func (e *enrollStatusError) Error() string {
	return fmt.Sprintf("enroll: %d %s", e.status, e.body)
}

func newNodeSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "nd_" + hex.EncodeToString(buf), nil
}

func (a *app) enroll(ctx context.Context) error {
	if a.cfg.NodeID != "" {
		return nil
	}
	if a.cfg.EnrollToken == "" {
		return fmt.Errorf("config %s has no enroll token", a.cfgPath)
	}
	if a.cfg.NodeSecret == "" {
		secret, err := newNodeSecret()
		if err != nil {
			return err
		}
		a.cfg.NodeSecret = secret
		if err := config.Save(a.cfgPath, a.cfg); err != nil {
			return err
		}
	}
	wait := 2 * time.Second
	for {
		err := a.enrollOnce(ctx)
		if err == nil {
			return nil
		}
		log.Printf("%v", err)
		delay := wait
		var statusErr *enrollStatusError
		if errors.As(err, &statusErr) && statusErr.status == http.StatusTooManyRequests && delay < 15*time.Second {
			delay = 15 * time.Second
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		if wait < 30*time.Second {
			wait *= 2
		}
	}
}

func (a *app) enrollOnce(ctx context.Context) error {
	host, _ := os.Hostname()
	body, _ := json.Marshal(map[string]string{
		"token":       a.cfg.EnrollToken,
		"node_secret": a.cfg.NodeSecret,
		"hostname":    host,
		"os":          runtime.GOOS,
		"arch":        runtime.GOARCH,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.cfg.Endpoint, "/")+"/agent/v1/enroll", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return &enrollStatusError{status: res.StatusCode, body: strings.TrimSpace(string(raw))}
	}
	var out struct {
		NodeID     string `json:"node_id"`
		NodeSecret string `json:"node_secret"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return err
	}
	if out.NodeID == "" {
		return fmt.Errorf("enroll response did not include a node id")
	}
	if out.NodeSecret != "" {
		a.cfg.NodeSecret = out.NodeSecret
	}
	if a.cfg.NodeSecret == "" {
		return fmt.Errorf("enroll response did not include a node secret")
	}
	a.cfg.NodeID = out.NodeID
	a.cfg.EnrollToken = ""
	return config.Save(a.cfgPath, a.cfg)
}

func (a *app) heartbeat(ctx context.Context) (heartbeatResponse, time.Duration, error) {
	var resp heartbeatResponse
	steps := a.pack.Heartbeat
	forcing := a.forceSpeed
	if forcing {
		a.forceSpeed = false
		steps = withForcedSpeed(steps)
	}
	saves, err := a.engine.Run(steps)
	if err != nil {
		log.Printf("heartbeat steps: %v", err)
		saves = map[string]any{}
	}
	if speed, ok := saves["speed"].(map[string]any); ok {
		if text, _ := speed["error"].(string); text != "" {
			log.Printf("speed: %s", text)
		}
	}
	payload := map[string]any{
		"core_version": version,
		"pack_version": a.pack.Version,
		"goos":         runtime.GOOS,
		"goarch":       runtime.GOARCH,
		"metrics":      saves,
	}
	if forcing {
		payload["metrics_refresh"] = true
	}
	if a.rtt > 0 {
		payload["api_rtt_ms"] = float64(a.rtt.Microseconds()) / 1000
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.cfg.Endpoint, "/")+"/agent/v1/heartbeat", bytes.NewReader(body))
	if err != nil {
		return resp, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.cfg.NodeSecret)
	start := time.Now()
	res, err := a.client.Do(req)
	if err != nil {
		return resp, 0, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	elapsed := time.Since(start)
	if res.StatusCode >= 300 {
		return resp, 0, fmt.Errorf("heartbeat status %d: %s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return resp, 0, err
	}
	net := elapsed - time.Duration(resp.HeldMS)*time.Millisecond
	if net < 0 {
		net = 0
	}
	return resp, net, nil
}

func (a *app) reportUpdate(status, target, errText string, progress int) {
	body, err := json.Marshal(map[string]any{
		"status":   status,
		"target":   target,
		"error":    errText,
		"progress": progress,
	})
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.cfg.Endpoint, "/")+"/agent/v1/update", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.cfg.NodeSecret)
	res, err := a.client.Do(req)
	if err != nil {
		log.Printf("update status: %v", err)
		return
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	if res.StatusCode >= 300 {
		log.Printf("update status: http %d", res.StatusCode)
	}
}

func withForcedSpeed(steps []map[string]any) []map[string]any {
	out := make([]map[string]any, len(steps))
	for i, step := range steps {
		next := make(map[string]any, len(step)+1)
		for key, value := range step {
			next[key] = value
		}
		if op, _ := next["op"].(string); op == "net.speed" {
			next["force"] = true
		}
		out[i] = next
	}
	return out
}

func (a *app) applyPack(raw json.RawMessage) {
	if len(raw) == 0 {
		return
	}
	var doc struct {
		Version      int              `json:"version"`
		CoreMin      string           `json:"core_min"`
		HeartbeatSec int              `json:"heartbeat_sec"`
		Heartbeat    []map[string]any `json:"heartbeat"`
		Document     json.RawMessage  `json:"document"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		log.Printf("pack: %v", err)
		return
	}
	body := raw
	if len(doc.Document) > 0 {
		body = doc.Document
		if err := json.Unmarshal(doc.Document, &doc); err != nil {
			log.Printf("pack document: %v", err)
			return
		}
	}
	if doc.Version == 0 || doc.Version == a.pack.Version {
		return
	}
	if versionLess(version, doc.CoreMin) {
		log.Printf("pack %d needs core %s, current %s", doc.Version, doc.CoreMin, version)
		return
	}
	if len(doc.Heartbeat) == 0 {
		return
	}
	next := config.Pack{Version: doc.Version, CoreMin: doc.CoreMin, HeartbeatSec: doc.HeartbeatSec, Heartbeat: doc.Heartbeat}
	if err := config.SavePack(config.StateDir(a.cfgPath), next, body); err != nil {
		log.Printf("save pack: %v", err)
		return
	}
	a.pack = next
	log.Printf("applied instruction pack %d", next.Version)
}

func (a *app) runJob(job interp.Job) {
	saves, err := a.engine.Run(job.Steps)
	result := map[string]any{"job_id": job.ID, "saves": saves, "ok": false}
	if err != nil {
		result["error"] = err.Error()
	} else if httpOK(saves) {
		result["ok"] = true
	}
	body, _ := json.Marshal(result)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.cfg.Endpoint, "/")+"/agent/v1/results", bytes.NewReader(body))
	if err != nil {
		log.Printf("result %s: %v", job.ID, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.cfg.NodeSecret)
	res, err := a.client.Do(req)
	if err != nil {
		log.Printf("result %s: %v", job.ID, err)
		return
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		log.Printf("result %s: status %d %s", job.ID, res.StatusCode, strings.TrimSpace(string(raw)))
	}
}

func httpOK(saves map[string]any) bool {
	httpSave, _ := saves["http"].(map[string]any)
	if httpSave == nil {
		return false
	}
	ok, _ := httpSave["ok"].(bool)
	return ok
}

func versionLess(a, b string) bool {
	av, bv := parseVersion(a), parseVersion(b)
	for i := 0; i < 3; i++ {
		if av[i] != bv[i] {
			return av[i] < bv[i]
		}
	}
	return false
}

func parseVersion(s string) [3]int {
	var out [3]int
	parts := strings.SplitN(s, ".", 3)
	for i := 0; i < len(parts) && i < 3; i++ {
		n := 0
		for _, r := range parts[i] {
			if r < '0' || r > '9' {
				break
			}
			n = n*10 + int(r-'0')
		}
		out[i] = n
	}
	return out
}
