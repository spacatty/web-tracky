package interp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptrace"
	"os"
	"runtime"
	"sync"
	"time"

	probing "github.com/prometheus-community/pro-bing"
)

type Job struct {
	ID    string           `json:"id"`
	Steps []map[string]any `json:"steps"`
}

type Engine struct {
	Version string
	mu      sync.Mutex
	lastRX  uint64
	lastTX  uint64
	lastAt  time.Time
	have    bool
}

func New(version string) *Engine {
	return &Engine{Version: version}
}

func (e *Engine) Run(steps []map[string]any) (map[string]any, error) {
	saves := map[string]any{}
	for _, step := range steps {
		op, _ := step["op"].(string)
		var value any
		var err error
		switch op {
		case "http.request":
			value, err = e.httpRequest(step)
		case "icmp.ping":
			value, err = icmpPing(step)
		case "net.sample":
			value, err = sampleNet(e)
		case "host.info":
			value, err = hostInfo(), nil
		default:
			return saves, fmt.Errorf("unknown op %q", op)
		}
		if err != nil {
			return saves, err
		}
		if name, _ := step["save"].(string); name != "" {
			saves[name] = value
		}
	}
	return saves, nil
}

func (e *Engine) httpRequest(step map[string]any) (any, error) {
	rawURL, _ := step["url"].(string)
	if rawURL == "" {
		return nil, fmt.Errorf("http.request requires url")
	}
	method, _ := step["method"].(string)
	if method == "" {
		method = http.MethodGet
	}
	timeout := durationMS(step["timeout_ms"], 10000)
	follow := true
	if value, ok := step["follow_redirects"].(bool); ok {
		follow = value
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, rawURL, nil)
	if err != nil {
		return map[string]any{"ok": false, "error": err.Error()}, nil
	}
	req.Header.Set("User-Agent", "tracky-agent/"+e.Version)
	if headers, ok := step["headers"].(map[string]any); ok {
		for key, value := range headers {
			if text, ok := value.(string); ok {
				req.Header.Set(key, text)
			}
		}
	}
	var ttfb time.Duration
	start := time.Now()
	req = req.WithContext(httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{
		GotFirstResponseByte: func() {
			if ttfb == 0 {
				ttfb = time.Since(start)
			}
		},
	}))
	client := &http.Client{Timeout: timeout}
	if !follow {
		client.CheckRedirect = func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}
	}
	res, err := client.Do(req)
	total := time.Since(start)
	if err != nil {
		return map[string]any{"ok": false, "error": err.Error(), "total_ms": millis(total), "ttfb_ms": millis(ttfb)}, nil
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<20))
	ok := statusAllowed(res.StatusCode, step["expect_status"])
	out := map[string]any{
		"ok":        ok,
		"status":    res.StatusCode,
		"ttfb_ms":   millis(ttfb),
		"total_ms":  millis(total),
		"final_url": res.Request.URL.String(),
	}
	if !ok {
		out["error"] = fmt.Sprintf("status %d", res.StatusCode)
	}
	return out, nil
}

func icmpPing(step map[string]any) (any, error) {
	host, _ := step["host"].(string)
	if host == "" {
		return nil, fmt.Errorf("icmp.ping requires host")
	}
	count := int(number(step["count"], 3))
	if count < 1 {
		count = 1
	}
	if count > 10 {
		count = 10
	}
	timeout := durationMS(step["timeout_ms"], 5000)
	stats, err := runPing(host, count, timeout, true)
	if err != nil {
		stats, err = runPing(host, count, timeout, false)
	}
	if err != nil {
		return map[string]any{"ok": false, "error": err.Error()}, nil
	}
	ok := stats.PacketsRecv > 0
	out := map[string]any{
		"ok":    ok,
		"rtt_ms": float64(stats.AvgRtt.Microseconds()) / 1000,
		"sent":  stats.PacketsSent,
		"recv":  stats.PacketsRecv,
		"loss":  stats.PacketLoss,
	}
	if !ok {
		out["error"] = "no reply"
	}
	return out, nil
}

func runPing(host string, count int, timeout time.Duration, privileged bool) (*probing.Statistics, error) {
	pinger, err := probing.NewPinger(host)
	if err != nil {
		return nil, err
	}
	pinger.Count = count
	pinger.Timeout = timeout
	pinger.SetPrivileged(privileged)
	if err := pinger.Run(); err != nil {
		return nil, err
	}
	return pinger.Statistics(), nil
}

func hostInfo() map[string]any {
	host, _ := os.Hostname()
	return map[string]any{
		"hostname": host,
		"os":       runtime.GOOS,
		"arch":     runtime.GOARCH,
		"kernel":   kernelVersion(),
	}
}

func statusAllowed(code int, expect any) bool {
	list := expectCodes(expect)
	if len(list) == 0 {
		return code >= 200 && code < 400
	}
	for _, item := range list {
		if item == code {
			return true
		}
	}
	return false
}

func expectCodes(value any) []int {
	switch typed := value.(type) {
	case []any:
		out := make([]int, 0, len(typed))
		for _, item := range typed {
			if n, ok := numberOK(item); ok {
				out = append(out, int(n))
			}
		}
		return out
	default:
		return nil
	}
}

func durationMS(value any, fallback int) time.Duration {
	n := int(number(value, float64(fallback)))
	if n < 100 {
		n = fallback
	}
	return time.Duration(n) * time.Millisecond
}

func number(value any, fallback float64) float64 {
	n, ok := numberOK(value)
	if !ok {
		return fallback
	}
	return n
}

func numberOK(value any) (float64, bool) {
	switch n := value.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

func millis(d time.Duration) float64 {
	return float64(d.Microseconds()) / 1000
}
