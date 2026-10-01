package pack

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

type Document struct {
	Version       int              `json:"version"`
	CoreMin       string           `json:"core_min"`
	HeartbeatSec  int              `json:"heartbeat_sec"`
	JobTimeoutSec int              `json:"job_timeout_sec"`
	Heartbeat     []map[string]any `json:"heartbeat"`
	Check         []map[string]any `json:"check"`
}

type Cache struct {
	path   string
	mu     sync.Mutex
	mod    time.Time
	doc    Document
	raw    []byte
}

func NewCache(path string) *Cache {
	return &Cache{path: path}
}

func (c *Cache) Load() (Document, []byte, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	info, err := os.Stat(c.path)
	if err != nil {
		return Document{}, nil, err
	}
	if !info.ModTime().After(c.mod) && c.doc.Version > 0 {
		return c.doc, append([]byte(nil), c.raw...), nil
	}
	raw, err := os.ReadFile(c.path)
	if err != nil {
		return Document{}, nil, err
	}
	doc, err := Parse(raw)
	if err != nil {
		return Document{}, nil, err
	}
	c.doc = doc
	c.raw = append([]byte(nil), raw...)
	c.mod = info.ModTime()
	return doc, append([]byte(nil), raw...), nil
}

func Parse(raw []byte) (Document, error) {
	var doc Document
	if err := json.Unmarshal(raw, &doc); err != nil {
		return doc, fmt.Errorf("pack: %w", err)
	}
	if doc.Version < 1 {
		return doc, fmt.Errorf("pack version must be >= 1")
	}
	if len(doc.Heartbeat) == 0 {
		return doc, fmt.Errorf("pack heartbeat steps are required")
	}
	if len(doc.Check) == 0 {
		return doc, fmt.Errorf("pack check steps are required")
	}
	if doc.HeartbeatSec < 5 {
		doc.HeartbeatSec = 5
	}
	if doc.HeartbeatSec > 60 {
		doc.HeartbeatSec = 60
	}
	if doc.JobTimeoutSec < 15 {
		doc.JobTimeoutSec = 15
	}
	if doc.JobTimeoutSec > 180 {
		doc.JobTimeoutSec = 180
	}
	if strings.TrimSpace(doc.CoreMin) == "" {
		doc.CoreMin = "0.1.0"
	}
	return doc, nil
}

func RenderCheck(doc Document, target string) (json.RawMessage, error) {
	u, err := url.Parse(target)
	if err != nil {
		return nil, err
	}
	if u.Hostname() == "" {
		return nil, fmt.Errorf("target url has no host")
	}
	raw, err := json.Marshal(doc.Check)
	if err != nil {
		return nil, err
	}
	urlEsc, err := json.Marshal(target)
	if err != nil {
		return nil, err
	}
	hostEsc, err := json.Marshal(u.Hostname())
	if err != nil {
		return nil, err
	}
	rendered := string(raw)
	rendered = strings.ReplaceAll(rendered, "{{url}}", strings.Trim(string(urlEsc), `"`))
	rendered = strings.ReplaceAll(rendered, "{{host}}", strings.Trim(string(hostEsc), `"`))
	if !json.Valid([]byte(rendered)) {
		return nil, fmt.Errorf("rendered check program is invalid json")
	}
	return json.RawMessage(rendered), nil
}
