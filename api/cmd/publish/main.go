package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
)

type artifact struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

type manifest struct {
	Version string              `json:"version"`
	Files   map[string]artifact `json:"files"`
}

func main() {
	version := flag.String("version", "0.2.0", "agent core version")
	out := flag.String("out", "dist/agent", "release directory")
	agent := flag.String("agent", "agent", "agent module directory")
	flag.Parse()
	if *version == "" {
		log.Fatal("version is required")
	}

	files := map[string]artifact{}
	for _, arch := range []string{"amd64", "arm64"} {
		rel := filepath.ToSlash(filepath.Join(*version, "linux-"+arch))
		dest := filepath.Join(*out, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			log.Fatal(err)
		}
		cmd := exec.Command("go", "build", "-trimpath", "-ldflags", "-s -w -X main.version="+*version, "-o", dest, "./cmd/agent")
		cmd.Dir = *agent
		cmd.Env = append(os.Environ(), "GOOS=linux", "GOARCH="+arch, "CGO_ENABLED=0")
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		log.Printf("building linux/%s", arch)
		if err := cmd.Run(); err != nil {
			log.Fatal(err)
		}
		sum, err := fileSHA(dest)
		if err != nil {
			log.Fatal(err)
		}
		files["linux/"+arch] = artifact{Path: rel, SHA256: sum}
	}

	body, err := json.MarshalIndent(manifest{Version: *version, Files: files}, "", "  ")
	if err != nil {
		log.Fatal(err)
	}
	body = append(body, '\n')
	manifestPath := filepath.Join(*out, "manifest.json")
	tmp := manifestPath + ".tmp"
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		log.Fatal(err)
	}
	if err := os.Rename(tmp, manifestPath); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("published agent %s\n", *version)
}

func fileSHA(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
