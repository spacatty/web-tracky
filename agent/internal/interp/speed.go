package interp

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"strconv"
	"time"
)

const (
	defaultDownBytes = 8_000_000
	defaultUpBytes   = 4_000_000
	minSpeedBytes    = 16 * 1024
)

func (e *Engine) netSpeed(step map[string]any) (any, error) {
	force, _ := step["force"].(bool)
	interval := time.Duration(clampInt(int(number(step["interval_sec"], 300)), 60, 3600)) * time.Second
	e.mu.Lock()
	if !force && e.speedOK && time.Since(e.speedAt) < interval {
		snap := e.speedSnapshotLocked()
		e.mu.Unlock()
		return snap, nil
	}
	if !force && !e.speedAttempt.IsZero() && time.Since(e.speedAttempt) < time.Minute {
		snap := e.speedSnapshotLocked()
		e.mu.Unlock()
		return snap, nil
	}
	e.speedAttempt = time.Now()
	e.mu.Unlock()

	timeout := durationMS(step["timeout_ms"], 6000)
	if timeout > 12*time.Second {
		timeout = 12 * time.Second
	}
	downBytes := clampInt(int(number(step["down_bytes"], defaultDownBytes)), 250_000, 32_000_000)
	upBytes := clampInt(int(number(step["up_bytes"], defaultUpBytes)), 250_000, 16_000_000)
	downURL, err := speedURL(step["down_url"], "https://speed.cloudflare.com/__down?bytes="+strconv.Itoa(downBytes))
	if err != nil {
		return e.finishSpeed(0, 0, fmt.Errorf("download url: %w", err))
	}
	upURL, err := speedURL(step["up_url"], "https://speed.cloudflare.com/__up")
	if err != nil {
		return e.finishSpeed(0, 0, fmt.Errorf("upload url: %w", err))
	}

	client := &http.Client{Transport: &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DisableCompression:    true,
		ResponseHeaderTimeout: timeout,
		IdleConnTimeout:       30 * time.Second,
	}}
	down, downErr := measureDownload(client, e.Version, downURL, timeout)
	up, upErr := measureUpload(client, e.Version, upURL, upBytes, timeout)
	var measureErr error
	switch {
	case downErr != nil && upErr != nil:
		measureErr = fmt.Errorf("%v; %v", downErr, upErr)
	case downErr != nil:
		measureErr = downErr
	case upErr != nil:
		measureErr = upErr
	}
	return e.finishSpeed(down, up, measureErr)
}

func (e *Engine) finishSpeed(down, up float64, measureErr error) (any, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if measureErr != nil && down < 1 && up < 1 {
		if e.speedOK {
			snap := e.speedSnapshotLocked()
			snap["error"] = measureErr.Error()
			return snap, nil
		}
		return map[string]any{
			"ok":       false,
			"down_bps": 0.0,
			"up_bps":   0.0,
			"error":    measureErr.Error(),
		}, nil
	}
	if down < 1 && e.speedOK {
		down = e.speedDown
	}
	if up < 1 && e.speedOK {
		up = e.speedUp
	}
	if down < 1 && up < 1 {
		msg := "speed test produced no sample"
		if measureErr != nil {
			msg = measureErr.Error()
		}
		return map[string]any{"ok": false, "down_bps": 0.0, "up_bps": 0.0, "error": msg}, nil
	}
	e.speedOK = true
	e.speedDown = down
	e.speedUp = up
	e.speedAt = time.Now()
	snap := e.speedSnapshotLocked()
	if measureErr != nil {
		snap["error"] = measureErr.Error()
	}
	return snap, nil
}

func (e *Engine) speedSnapshotLocked() map[string]any {
	if !e.speedOK {
		return map[string]any{"ok": false, "down_bps": 0.0, "up_bps": 0.0}
	}
	return map[string]any{
		"ok":          true,
		"down_bps":    e.speedDown,
		"up_bps":      e.speedUp,
		"measured_at": e.speedAt.UTC().Format(time.RFC3339),
	}
}

func measureDownload(client *http.Client, version, rawURL string, timeout time.Duration) (float64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", "tracky-agent/"+version)
	var first time.Time
	req = req.WithContext(httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{
		GotFirstResponseByte: func() {
			if first.IsZero() {
				first = time.Now()
			}
		},
	}))
	res, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("download: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return 0, fmt.Errorf("download status %d", res.StatusCode)
	}
	n, readErr := io.Copy(io.Discard, res.Body)
	if first.IsZero() {
		first = time.Now()
	}
	elapsed := time.Since(first)
	if elapsed < time.Millisecond {
		elapsed = time.Millisecond
	}
	if n >= minSpeedBytes {
		return float64(n) * 8 / elapsed.Seconds(), nil
	}
	if readErr != nil && ctx.Err() == nil {
		return 0, fmt.Errorf("download: %w", readErr)
	}
	return 0, fmt.Errorf("download sample too small (%d bytes)", n)
}

func measureUpload(client *http.Client, version, rawURL string, nbytes int, timeout time.Duration) (float64, error) {
	chunk := make([]byte, 32*1024)
	if _, err := rand.Read(chunk); err != nil {
		return 0, err
	}
	body := &countReader{r: &chunkReader{chunk: chunk, n: nbytes}}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, body)
	if err != nil {
		return 0, err
	}
	req.ContentLength = int64(nbytes)
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("User-Agent", "tracky-agent/"+version)
	start := time.Now()
	res, err := client.Do(req)
	elapsed := time.Since(start)
	if res != nil {
		io.Copy(io.Discard, io.LimitReader(res.Body, 1<<20))
		res.Body.Close()
		if res.StatusCode >= 300 {
			return 0, fmt.Errorf("upload status %d", res.StatusCode)
		}
	}
	sent := body.n
	if elapsed < time.Millisecond {
		elapsed = time.Millisecond
	}
	if sent >= minSpeedBytes && (err == nil || sent > 0) {
		return float64(sent) * 8 / elapsed.Seconds(), nil
	}
	if err != nil {
		return 0, fmt.Errorf("upload: %w", err)
	}
	return 0, fmt.Errorf("upload sample too small")
}

func speedURL(value any, fallback string) (string, error) {
	raw, _ := value.(string)
	if raw == "" {
		raw = fallback
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", fmt.Errorf("must be an absolute http(s) url")
	}
	return parsed.String(), nil
}

func clampInt(n, min, max int) int {
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}

type countReader struct {
	r io.Reader
	n int64
}

func (c *countReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

type chunkReader struct {
	chunk []byte
	n     int
	off   int
}

func (r *chunkReader) Read(p []byte) (int, error) {
	if r.n <= 0 {
		return 0, io.EOF
	}
	if len(r.chunk) == 0 {
		return 0, io.EOF
	}
	if len(p) > r.n {
		p = p[:r.n]
	}
	written := 0
	for written < len(p) {
		copied := copy(p[written:], r.chunk[r.off:])
		if copied == 0 {
			r.off = 0
			continue
		}
		r.off += copied
		if r.off >= len(r.chunk) {
			r.off = 0
		}
		written += copied
	}
	r.n -= written
	return written, nil
}
