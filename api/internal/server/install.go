package server

import (
	"net/http"
	"strings"
)

func (s *Server) installScript(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if !validInstallToken(token) {
		http.Error(w, "token query parameter is required\n", http.StatusBadRequest)
		return
	}
	endpoint := r.URL.Query().Get("endpoint")
	if endpoint == "" {
		endpoint = s.cfg.AgentPublicURL
	}
	endpoint, err := validateEndpoint(endpoint)
	if err != nil {
		http.Error(w, "endpoint must be an http(s) origin\n", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(strings.ReplaceAll(renderInstallScript(endpoint, token), "\r\n", "\n")))
}

func renderInstallScript(endpoint, token string) string {
	return `#!/bin/sh
set -eu
ENDPOINT=` + shQuote(endpoint) + `
TOKEN=` + shQuote(token) + `
if [ "$(id -u)" -ne 0 ]; then
  echo "run this installer as root" >&2
  exit 1
fi
arch=$(uname -m)
case "$arch" in
  x86_64) goarch=amd64 ;;
  aarch64|arm64) goarch=arm64 ;;
  *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
esac
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
curl -fsSL "$ENDPOINT/agent/v1/download/linux/$goarch" -o "$tmp"
expected=$(curl -fsSL "$ENDPOINT/agent/v1/download/linux/$goarch/sha256")
expected=$(printf '%s' "$expected" | tr -d '[:space:]')
actual=$(sha256sum "$tmp" | awk '{print $1}')
if [ "$expected" != "$actual" ]; then
  echo "agent checksum mismatch" >&2
  exit 1
fi
install -m 0755 "$tmp" /usr/local/bin/tracky-agent
mkdir -p /etc/tracky-agent /var/lib/tracky-agent
CONFIG=/etc/tracky-agent/config.json
if [ -f "$CONFIG" ] && grep -q '"node_id"[[:space:]]*:[[:space:]]*"[^"]' "$CONFIG"; then
  echo "keeping the existing enrollment"
else
  umask 077
  cat > "$CONFIG" <<EOF
{
  "endpoint": "$ENDPOINT",
  "enroll_token": "$TOKEN"
}
EOF
  chmod 600 "$CONFIG"
fi
cat > /etc/systemd/system/tracky-agent.service <<'UNIT'
[Unit]
Description=Tracky agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/tracky-agent
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl enable tracky-agent
  systemctl restart tracky-agent
  echo "tracky-agent is running"
else
  echo "systemd was not found. start it with: /usr/local/bin/tracky-agent"
fi
`
}
