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

func TestExpectRulesReplaceDefaultSuccess(t *testing.T) {
	rules := []any{
		map[string]any{"status": float64(404), "body": "empty"},
		map[string]any{"status": float64(404), "body": "contains", "text": "404 not found", "join": "or"},
		map[string]any{"status": float64(404), "body": "contains", "text": "can not get /", "join": "or"},
	}
	if !matchExpect(404, "", rules) || !matchExpect(404, "\n", rules) {
		t.Fatal("empty body should match")
	}
	if !matchExpect(404, "404 Not Found", rules) {
		t.Fatal("contains should be case-insensitive")
	}
	if !matchExpect(404, "prefix can not get / suffix", rules) {
		t.Fatal("third alternative should match")
	}
	if matchExpect(200, "ok", rules) || matchExpect(404, "missing page", rules) {
		t.Fatal("unlisted status and body should fail")
	}

	and := []any{
		map[string]any{"status": float64(404), "body": "contains", "text": "404 not found"},
		map[string]any{"status": float64(404), "body": "contains", "text": "extra", "join": "and"},
	}
	if matchExpect(404, "404 not found", and) {
		t.Fatal("and should require both snippets")
	}
	if !matchExpect(404, "404 not found extra", and) {
		t.Fatal("and should pass when both snippets are present")
	}
}

func TestHTTPExpectIgnoresDefaultOK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	saves, err := New("0.1.0").Run([]map[string]any{{
		"op":     "http.request",
		"url":    srv.URL,
		"expect": []any{map[string]any{"status": float64(404), "body": "empty"}},
		"save":   "http",
	}})
	if err != nil {
		t.Fatal(err)
	}
	got := saves["http"].(map[string]any)
	if got["ok"] != true {
		t.Fatalf("empty 404 should succeed: %#v", got)
	}

	okSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	defer okSrv.Close()
	saves, err = New("0.1.0").Run([]map[string]any{{
		"op":     "http.request",
		"url":    okSrv.URL,
		"expect": []any{map[string]any{"status": float64(404), "body": "contains", "text": "404 not found"}},
		"save":   "http",
	}})
	if err != nil {
		t.Fatal(err)
	}
	got = saves["http"].(map[string]any)
	if got["ok"] != false {
		t.Fatalf("200 should not be a default success: %#v", got)
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
