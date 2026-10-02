package update

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

type Core struct {
	Version string `json:"version"`
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
}

func Apply(rawURL, sum string, report func(phase string, progress int)) error {
	if report == nil {
		report = func(string, int) {}
	}
	if rawURL == "" || sum == "" {
		return fmt.Errorf("missing core url or checksum")
	}
	report("downloading", 0)
	client := &http.Client{Timeout: 2 * time.Minute}
	res, err := client.Get(rawURL)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("download status %d", res.StatusCode)
	}
	lastBucket := -1
	body, err := readLimited(res.Body, 200<<20, func(n int64) {
		pct := percent(n, res.ContentLength)
		bucket := pct / 10
		if bucket == lastBucket && pct != 100 {
			return
		}
		lastBucket = bucket
		report("downloading", pct)
	})
	if err != nil {
		return err
	}
	report("verifying", 100)
	got := sha256.Sum256(body)
	if hex.EncodeToString(got[:]) != sum {
		return fmt.Errorf("checksum mismatch")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	tmp := exe + ".new"
	report("installing", 100)
	if err := os.WriteFile(tmp, body, 0o755); err != nil {
		return err
	}
	if err := os.Rename(tmp, exe); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	report("restarting", 100)
	return reexec(exe)
}

func readLimited(r io.Reader, limit int64, on func(int64)) ([]byte, error) {
	buf := make([]byte, 32<<10)
	out := make([]byte, 0, 32<<10)
	var n int64
	for {
		if n >= limit {
			return nil, fmt.Errorf("download exceeds %d bytes", limit)
		}
		want := int64(len(buf))
		if remain := limit - n; remain < want {
			want = remain
		}
		nr, err := r.Read(buf[:want])
		n += int64(nr)
		out = append(out, buf[:nr]...)
		if on != nil && nr > 0 {
			on(n)
		}
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return nil, err
		}
	}
}

func percent(read, total int64) int {
	if total <= 0 || read <= 0 {
		return 0
	}
	if read >= total {
		return 100
	}
	return int(read * 100 / total)
}
