package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

type File struct {
	Endpoint    string `json:"endpoint"`
	EnrollToken string `json:"enroll_token,omitempty"`
	NodeID      string `json:"node_id,omitempty"`
	NodeSecret  string `json:"node_secret,omitempty"`
}

type Pack struct {
	Version      int              `json:"version"`
	CoreMin      string           `json:"core_min"`
	HeartbeatSec int              `json:"heartbeat_sec"`
	Heartbeat    []map[string]any `json:"heartbeat"`
}

func Load(path string) (File, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return File{}, fmt.Errorf("read config: %w", err)
	}
	var cfg File
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return File{}, fmt.Errorf("parse config: %w", err)
	}
	if cfg.Endpoint == "" {
		return File{}, fmt.Errorf("config endpoint is required")
	}
	return cfg, nil
}

func Save(path string, cfg File) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func StateDir(configPath string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(filepath.Dir(configPath), "state")
	}
	return "/var/lib/tracky-agent"
}

func LoadPack(dir string) Pack {
	fallback := Pack{
		Version:      0,
		HeartbeatSec: 15,
		Heartbeat: []map[string]any{
			{"op": "host.info", "save": "host"},
			{"op": "net.sample", "save": "net"},
			{"op": "net.speed", "save": "speed", "interval_sec": 300},
		},
	}
	raw, err := os.ReadFile(filepath.Join(dir, "pack.json"))
	if err != nil {
		return fallback
	}
	var pack Pack
	if err := json.Unmarshal(raw, &pack); err != nil || len(pack.Heartbeat) == 0 {
		return fallback
	}
	if pack.HeartbeatSec <= 0 {
		pack.HeartbeatSec = 15
	}
	return pack
}

func SavePack(dir string, pack Pack, raw []byte) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if len(raw) == 0 {
		var err error
		raw, err = json.MarshalIndent(pack, "", "  ")
		if err != nil {
			return err
		}
	}
	path := filepath.Join(dir, "pack.json")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
