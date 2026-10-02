package interp

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestNetSpeedMeasuresAndCaches(t *testing.T) {
	var hits atomic.Int32
	payload := make([]byte, 64*1024)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.Method == http.MethodPost {
			_, _ = io.Copy(io.Discard, r.Body)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		_, _ = w.Write(payload)
	}))
	defer srv.Close()

	engine := New("0.2.0")
	step := map[string]any{
		"op":           "net.speed",
		"save":         "speed",
		"interval_sec": float64(300),
		"down_url":     srv.URL,
		"up_url":       srv.URL,
		"up_bytes":     float64(250000),
		"timeout_ms":   float64(5000),
	}
	first, err := engine.Run([]map[string]any{step})
	if err != nil {
		t.Fatal(err)
	}
	speed := first["speed"].(map[string]any)
	if speed["ok"] != true {
		t.Fatalf("speed = %#v", speed)
	}
	down, _ := speed["down_bps"].(float64)
	up, _ := speed["up_bps"].(float64)
	if down <= 0 || up <= 0 {
		t.Fatalf("down=%v up=%v speed=%#v", down, up, speed)
	}
	if speed["measured_at"] == "" {
		t.Fatalf("missing measured_at: %#v", speed)
	}
	after := hits.Load()
	if after < 2 {
		t.Fatalf("hits = %d", after)
	}
	if _, err := engine.Run([]map[string]any{step}); err != nil {
		t.Fatal(err)
	}
	if hits.Load() != after {
		t.Fatalf("cached run hit the network: %d -> %d", after, hits.Load())
	}
}

func TestNetSpeedFailureBackoff(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		http.Error(w, "no", http.StatusBadGateway)
	}))
	defer srv.Close()
	engine := New("0.2.0")
	step := map[string]any{
		"op":       "net.speed",
		"save":     "speed",
		"down_url": srv.URL,
		"up_url":   srv.URL,
	}
	saves, err := engine.Run([]map[string]any{step})
	if err != nil {
		t.Fatal(err)
	}
	speed := saves["speed"].(map[string]any)
	if speed["ok"] != false {
		t.Fatalf("speed = %#v", speed)
	}
	if speed["error"] == "" {
		t.Fatal("expected error")
	}
	after := hits.Load()
	if _, err := engine.Run([]map[string]any{step}); err != nil {
		t.Fatal(err)
	}
	if hits.Load() != after {
		t.Fatalf("failure was retried immediately: %d -> %d", after, hits.Load())
	}
	forced := map[string]any{
		"op":       "net.speed",
		"save":     "speed",
		"force":    true,
		"down_url": srv.URL,
		"up_url":   srv.URL,
	}
	if _, err := engine.Run([]map[string]any{forced}); err != nil {
		t.Fatal(err)
	}
	if hits.Load() == after {
		t.Fatal("force did not bypass the failure backoff")
	}
}
