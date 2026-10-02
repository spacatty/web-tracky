package server

import (
	"net/http"
	"strings"
	"testing"
)

func TestClientIPUsesProxyHeaderFromDockerGateway(t *testing.T) {
	req := httptestRequest("172.20.0.1:54322")
	req.Header.Set("X-Real-IP", "203.0.113.10")
	req.Header.Set("X-Forwarded-For", "198.51.100.1, 203.0.113.10")
	if got := clientIP(req); got != "203.0.113.10" {
		t.Fatalf("clientIP = %q", got)
	}
}

func TestClientIPUsesLastForwardedWhenRealIPMissing(t *testing.T) {
	req := httptestRequest("172.20.0.1:54322")
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 203.0.113.10")
	if got := clientIP(req); got != "203.0.113.10" {
		t.Fatalf("clientIP = %q", got)
	}
}

func TestValidNodeSecret(t *testing.T) {
	if !validNodeSecret("nd_" + strings.Repeat("ab", 32)) {
		t.Fatal("expected 32-byte hex secret to pass")
	}
	if validNodeSecret("nd_abc") || validNodeSecret("trk_"+strings.Repeat("ab", 32)) || validNodeSecret("nd_"+strings.Repeat("AB", 32)) {
		t.Fatal("expected malformed secrets to fail")
	}
}

func TestClientIPIgnoresSpoofedForwardedFromPublicPeer(t *testing.T) {
	req := httptestRequest("203.0.113.10:54322")
	req.Header.Set("X-Real-IP", "1.2.3.4")
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	if got := clientIP(req); got != "203.0.113.10" {
		t.Fatalf("clientIP = %q", got)
	}
}

func httptestRequest(remote string) *http.Request {
	req, err := http.NewRequest(http.MethodPost, "http://api/agent/heartbeat", nil)
	if err != nil {
		panic(err)
	}
	req.RemoteAddr = remote
	return req
}
