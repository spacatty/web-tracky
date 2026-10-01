package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Addr                string
	DatabaseURL         string
	SessionSecret       string
	Registration        string
	BootstrapEmail      string
	BootstrapPassword   string
	AppPublicURL        string
	AgentPublicURL      string
	MinCheckIntervalSec int
	RetentionDays       int
	GeoLookupURL        string
	PackPath            string
	ReleaseDir          string
}

func Load() (Config, error) {
	cfg := Config{
		Addr:                env("HTTP_ADDR", ":8080"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		SessionSecret:       os.Getenv("SESSION_SECRET"),
		Registration:        strings.ToLower(env("AUTH_REGISTRATION", "closed")),
		BootstrapEmail:      strings.ToLower(strings.TrimSpace(os.Getenv("BOOTSTRAP_ADMIN_EMAIL"))),
		BootstrapPassword:   os.Getenv("BOOTSTRAP_ADMIN_PASSWORD"),
		AppPublicURL:        strings.TrimRight(env("APP_PUBLIC_URL", "http://localhost:3000"), "/"),
		AgentPublicURL:      strings.TrimRight(env("AGENT_PUBLIC_URL", "http://localhost:8080"), "/"),
		MinCheckIntervalSec: envInt("MIN_CHECK_INTERVAL_SEC", 30),
		RetentionDays:       envInt("METRICS_RETENTION_DAYS", 30),
		GeoLookupURL:        os.Getenv("GEO_LOOKUP_URL"),
		PackPath:            resolveExisting(env("PACK_PATH", "packs/v1.json")),
		ReleaseDir:          resolveExisting(env("RELEASE_DIR", "dist/agent")),
	}
	if cfg.DatabaseURL == "" {
		return cfg, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.SessionSecret == "" {
		return cfg, fmt.Errorf("SESSION_SECRET is required")
	}
	if cfg.Registration != "open" && cfg.Registration != "closed" {
		return cfg, fmt.Errorf("AUTH_REGISTRATION must be open or closed")
	}
	if cfg.MinCheckIntervalSec < 10 {
		cfg.MinCheckIntervalSec = 10
	}
	if cfg.RetentionDays < 1 {
		cfg.RetentionDays = 1
	}
	if err := os.MkdirAll(cfg.ReleaseDir, 0o755); err != nil {
		return cfg, err
	}
	return cfg, nil
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func resolveExisting(p string) string {
	if p == "" || filepath.IsAbs(p) {
		return p
	}
	cwd, err := os.Getwd()
	if err != nil {
		return p
	}
	direct := filepath.Join(cwd, p)
	parent := filepath.Clean(filepath.Join(cwd, "..", p))
	directOK := pathHasContent(direct)
	parentOK := pathHasContent(parent)
	if parentOK && !directOK {
		return parent
	}
	if directOK {
		return direct
	}
	if filepath.Base(cwd) == "api" {
		return parent
	}
	return direct
}

func pathHasContent(p string) bool {
	info, err := os.Stat(p)
	if err != nil {
		return false
	}
	if !info.IsDir() {
		return true
	}
	entries, err := os.ReadDir(p)
	return err == nil && len(entries) > 0
}
