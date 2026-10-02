package update

import (
	"bytes"
	"io"
	"testing"
)

func TestPercent(t *testing.T) {
	if percent(0, 100) != 0 || percent(50, 100) != 50 || percent(100, 100) != 100 || percent(10, 0) != 0 {
		t.Fatalf("percent buckets")
	}
}

func TestReadLimitedReportsBytes(t *testing.T) {
	var got int64
	body, err := readLimited(bytes.NewReader([]byte("abcdef")), 10, func(n int64) { got = n })
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "abcdef" || got != 6 {
		t.Fatalf("body %q read %d", body, got)
	}
}

func TestReadLimitedRejectsOverflow(t *testing.T) {
	_, err := readLimited(bytes.NewReader([]byte("abcdef")), 3, nil)
	if err == nil {
		t.Fatal("expected limit error")
	}
	if err == io.EOF {
		t.Fatal("unexpected eof")
	}
}
