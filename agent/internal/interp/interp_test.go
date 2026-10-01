package interp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPRequestRecordsStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") == "" {
			t.Error("missing user agent")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	engine := New("0.1.0")
	saves, err := engine.Run([]map[string]any{{
		"op":   "http.request",
		"url":  srv.URL,
		"save": "http",
	}})
	if err != nil {
		t.Fatal(err)
	}
	got := saves["http"].(map[string]any)
	if got["ok"] != true {
		t.Fatalf("ok = %#v", got)
	}
	if got["status"] != http.StatusNoContent {
		t.Fatalf("status = %#v", got["status"])
	}
}

func TestExpectStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	defer srv.Close()
	engine := New("0.1.0")
	saves, err := engine.Run([]map[string]any{{
		"op":            "http.request",
		"url":           srv.URL,
		"expect_status": []any{float64(418)},
		"save":          "http",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if saves["http"].(map[string]any)["ok"] != true {
		t.Fatalf("expected 418 to be allowed: %#v", saves["http"])
	}
}

func TestUnknownOp(t *testing.T) {
	_, err := New("0.1.0").Run([]map[string]any{{"op": "shell"}})
	if err == nil {
		t.Fatal("expected unknown op to fail")
	}
}

func TestHostInfo(t *testing.T) {
	saves, err := New("0.1.0").Run([]map[string]any{{"op": "host.info", "save": "host"}})
	if err != nil {
		t.Fatal(err)
	}
	host := saves["host"].(map[string]any)
	if host["os"] == "" || host["hostname"] == "" {
		t.Fatalf("host = %#v", host)
	}
}
