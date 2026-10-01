package pack

import "testing"

func TestRenderCheckSubstitutesURL(t *testing.T) {
	doc, err := Parse([]byte(`{
		"version": 1,
		"core_min": "0.1.0",
		"heartbeat_sec": 15,
		"job_timeout_sec": 60,
		"heartbeat": [{"op": "host.info", "save": "host"}],
		"check": [
			{"op": "http.request", "url": "{{url}}", "save": "http"},
			{"op": "icmp.ping", "host": "{{host}}", "save": "ping"}
		]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := RenderCheck(doc, `https://example.com:8443/health?a=1&b=2`)
	if err != nil {
		t.Fatal(err)
	}
	var steps []map[string]any
	if err := jsonUnmarshal(raw, &steps); err != nil {
		t.Fatal(err)
	}
	if steps[0]["url"] != "https://example.com:8443/health?a=1&b=2" {
		t.Fatalf("url = %#v", steps[0]["url"])
	}
	if steps[1]["host"] != "example.com" {
		t.Fatalf("host = %#v", steps[1]["host"])
	}
}

func TestParseRejectsEmptyCheck(t *testing.T) {
	_, err := Parse([]byte(`{"version":1,"heartbeat":[{"op":"host.info"}],"check":[]}`))
	if err == nil {
		t.Fatal("expected error")
	}
}
