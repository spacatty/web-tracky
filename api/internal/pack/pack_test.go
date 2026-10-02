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
	raw, err := RenderCheck(doc, `https://example.com:8443/health?a=1&b=2`, nil)
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

func TestRenderCheckInjectsSuccessRules(t *testing.T) {
	doc, err := Parse([]byte(`{
		"version": 1,
		"heartbeat": [{"op": "host.info"}],
		"check": [
			{"op": "http.request", "url": "{{url}}", "save": "http"},
			{"op": "icmp.ping", "host": "{{host}}", "save": "ping"}
		]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := RenderCheck(doc, "https://example.com/missing", []SuccessRule{
		{Status: 404, Body: "empty"},
		{Status: 404, Body: "contains", Text: `can not get /`, Join: "or"},
	})
	if err != nil {
		t.Fatal(err)
	}
	var steps []map[string]any
	if err := jsonUnmarshal(raw, &steps); err != nil {
		t.Fatal(err)
	}
	expect, ok := steps[0]["expect"].([]any)
	if !ok || len(expect) != 2 {
		t.Fatalf("expect = %#v", steps[0]["expect"])
	}
	second := expect[1].(map[string]any)
	if second["text"] != "can not get /" || second["join"] != "or" {
		t.Fatalf("second = %#v", second)
	}
	if _, injected := steps[1]["expect"]; injected {
		t.Fatal("ping step should not receive expect")
	}
}

func TestNormalizeSuccessRules(t *testing.T) {
	rules, err := NormalizeSuccessRules([]SuccessRule{
		{Status: 404, Body: "empty", Join: "and"},
		{Status: 404, Body: "contains", Text: " 404 not found "},
	})
	if err != nil {
		t.Fatal(err)
	}
	if rules[0].Join != "" || rules[1].Join != "or" || rules[1].Text != "404 not found" {
		t.Fatalf("%#v", rules)
	}
	if _, err := NormalizeSuccessRules([]SuccessRule{{Status: 404, Body: "contains"}}); err == nil {
		t.Fatal("expected missing text to fail")
	}
	if _, err := NormalizeSuccessRules([]SuccessRule{{Status: 99, Body: "any"}}); err == nil {
		t.Fatal("expected bad status to fail")
	}
}

func TestParseRejectsEmptyCheck(t *testing.T) {
	_, err := Parse([]byte(`{"version":1,"heartbeat":[{"op":"host.info"}],"check":[]}`))
	if err == nil {
		t.Fatal("expected error")
	}
}
