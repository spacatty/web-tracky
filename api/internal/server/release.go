package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type releaseArtifact struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

type releaseManifest struct {
	Version string                      `json:"version"`
	Files   map[string]releaseArtifact `json:"files"`
}

func (s *Server) loadManifest() (releaseManifest, error) {
	path := filepath.Join(s.cfg.ReleaseDir, "manifest.json")
	info, err := os.Stat(path)
	if err != nil {
		return releaseManifest{}, err
	}
	s.manifestMu.Lock()
	defer s.manifestMu.Unlock()
	if !info.ModTime().After(s.manifestAt) && s.manifest.Version != "" {
		return s.manifest, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return releaseManifest{}, err
	}
	var manifest releaseManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return releaseManifest{}, err
	}
	s.manifest = manifest
	s.manifestAt = info.ModTime()
	return manifest, nil
}

func (s *Server) coreInfo(goos, goarch string) map[string]string {
	manifest, err := s.loadManifest()
	if err != nil || manifest.Version == "" {
		return map[string]string{"version": "", "url": "", "sha256": ""}
	}
	full, art, err := s.artifactFile(manifest, manifest.Version, goos, goarch)
	if err != nil {
		return map[string]string{"version": manifest.Version, "url": "", "sha256": ""}
	}
	if _, err := os.Stat(full); err != nil {
		return map[string]string{"version": manifest.Version, "url": "", "sha256": ""}
	}
	return map[string]string{
		"version": manifest.Version,
		"url":     s.cfg.AgentPublicURL + "/agent/v1/releases/" + manifest.Version + "/" + goos + "/" + goarch,
		"sha256":  art.SHA256,
	}
}

func (s *Server) artifactFile(manifest releaseManifest, version, goos, goarch string) (string, releaseArtifact, error) {
	if version != "" && manifest.Version != version {
		return "", releaseArtifact{}, errNotFound
	}
	art, ok := manifest.Files[goos+"/"+goarch]
	if !ok || art.Path == "" || strings.Contains(art.Path, "..") || filepath.IsAbs(art.Path) {
		return "", releaseArtifact{}, errNotFound
	}
	return filepath.Join(s.cfg.ReleaseDir, filepath.FromSlash(art.Path)), art, nil
}

func (s *Server) manifestHTTP(w http.ResponseWriter, r *http.Request) {
	manifest, err := s.loadManifest()
	if err != nil {
		writeErr(w, http.StatusNotFound, "no agent release published")
		return
	}
	writeJSON(w, http.StatusOK, manifest)
}

func (s *Server) downloadCurrent(w http.ResponseWriter, r *http.Request) {
	s.serveRelease(w, r, "")
}

func (s *Server) downloadSHA(w http.ResponseWriter, r *http.Request) {
	manifest, err := s.loadManifest()
	if err != nil {
		http.Error(w, "no agent release published\n", http.StatusNotFound)
		return
	}
	_, art, err := s.artifactFile(manifest, manifest.Version, r.PathValue("goos"), r.PathValue("goarch"))
	if err != nil {
		http.Error(w, "release not found\n", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(art.SHA256 + "\n"))
}

func (s *Server) downloadVersion(w http.ResponseWriter, r *http.Request) {
	s.serveRelease(w, r, r.PathValue("version"))
}

func (s *Server) serveRelease(w http.ResponseWriter, r *http.Request, version string) {
	manifest, err := s.loadManifest()
	if err != nil {
		http.Error(w, "no agent release published\n", http.StatusNotFound)
		return
	}
	if version == "" {
		version = manifest.Version
	}
	full, _, err := s.artifactFile(manifest, version, r.PathValue("goos"), r.PathValue("goarch"))
	if err != nil {
		http.Error(w, "release not found\n", http.StatusNotFound)
		return
	}
	w.Header().Set("X-Tracky-Agent-Version", version)
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, full)
}
