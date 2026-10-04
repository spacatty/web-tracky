package server

import (
	"net/http"
	"strings"
	"testing"
	"time"
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

func TestChartWindowUsesFallback(t *testing.T) {
	req := httptestRequest("127.0.0.1:1")
	req.URL.RawQuery = ""
	from, to, err := chartWindow(req, 6*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	span := to.Sub(from)
	if span < 6*time.Hour-time.Second || span > 6*time.Hour+time.Second {
		t.Fatalf("span = %s", span)
	}
}

func TestParseLinkList(t *testing.T) {
	items, err := parseLinkList("\uFEFFhttps://a.example\n# skip\n\nBilling https://b.example/health.\nexample.com/health\nhttps://a.example\nhttps://c.example, https://d.example", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 5 {
		t.Fatalf("len = %d", len(items))
	}
	if items[1].Name != "Billing" || items[1].URL != "https://b.example/health" {
		t.Fatalf("named = %#v", items[1])
	}
	if items[2].URL != "https://example.com/health" || linkName(items[2]) != "example.com" {
		t.Fatalf("bare = %#v name %q", items[2], linkName(items[2]))
	}
	if linkName(items[1]) != "Billing" {
		t.Fatalf("name = %q", linkName(items[1]))
	}
}

func TestParseLinkListRejectsProse(t *testing.T) {
	if _, err := parseLinkList("not a link", 50); err == nil {
		t.Fatal("expected error")
	}
	if _, err := parseLinkList("hello", 50); err == nil {
		t.Fatal("expected bare word to fail")
	}
}

func TestParseLinkListLimit(t *testing.T) {
	_, err := parseLinkList("https://a.example\nhttps://b.example", 1)
	if err == nil || !strings.Contains(err.Error(), "at most 1") {
		t.Fatalf("err = %v", err)
	}
}

func TestChartWindowRejectsPartialRange(t *testing.T) {
	req := httptestRequest("127.0.0.1:1")
	req.URL.RawQuery = "from=2026-10-01T00:00:00Z"
	if _, _, err := chartWindow(req, time.Hour); err == nil {
		t.Fatal("expected error")
	}
}

func TestChartWindowClampsFutureAndRejectsLongSpan(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	req := httptestRequest("127.0.0.1:1")
	req.URL.RawQuery = "from=" + now.Add(-2*time.Hour).Format(time.RFC3339) + "&to=" + now.Add(3*time.Hour).Format(time.RFC3339)
	from, to, err := chartWindow(req, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if to.After(time.Now().UTC().Add(time.Second)) {
		t.Fatalf("to = %s", to)
	}
	if !from.Before(to) {
		t.Fatalf("from %s to %s", from, to)
	}
	req.URL.RawQuery = "from=" + now.Add(-40*24*time.Hour).Format(time.RFC3339) + "&to=" + now.Format(time.RFC3339)
	if _, _, err := chartWindow(req, time.Hour); err == nil {
		t.Fatal("expected long range to fail")
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
