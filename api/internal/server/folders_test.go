package server

import (
	"strings"
	"testing"
	"time"
)

func TestNormalizeFolder(t *testing.T) {
	name, desc, color, icon, err := normalizeFolder("  Production ", " main sites ", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if name != "Production" || desc != "main sites" || color != "slate" || icon != "folder" {
		t.Fatalf("got %q %q %q %q", name, desc, color, icon)
	}
	cases := []struct{ name, desc, color, icon string }{
		{"", "", "", ""},
		{"x", strings.Repeat("a", 281), "", ""},
		{"x", "", "neon", ""},
		{"x", "", "", "rocket-ship"},
	}
	for _, c := range cases {
		if _, _, _, _, err := normalizeFolder(c.name, c.desc, c.color, c.icon); err == nil {
			t.Errorf("expected error for %+v", c)
		}
	}
}

func TestGroupBinSeconds(t *testing.T) {
	cases := map[time.Duration]int{
		time.Hour:          300,
		24 * time.Hour:     1440,
		7 * 24 * time.Hour: 10080,
	}
	for span, want := range cases {
		if got := groupBinSeconds(span); got != want {
			t.Errorf("groupBinSeconds(%v) = %d, want %d", span, got, want)
		}
	}
}
