package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const sessionCookie = "tracky_session"

var (
	errNotFound   = errors.New("not found")
	errForbidden  = errors.New("forbidden")
	errBadRequest = errors.New("bad request")
)

type User struct {
	ID    string
	Email string
	Role  string
}

func (u User) Admin() bool { return u.Role == "admin" }

type ctxKey struct{}

func withUser(ctx context.Context, u User) context.Context {
	return context.WithValue(ctx, ctxKey{}, u)
}

func currentUser(ctx context.Context) User {
	u, _ := ctx.Value(ctxKey{}).(User)
	return u
}

type groupRef struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Visibility string `json:"visibility"`
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func writeAPIError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errNotFound):
		writeErr(w, http.StatusNotFound, "not found")
	case errors.Is(err, errForbidden):
		writeErr(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, errBadRequest):
		writeErr(w, http.StatusBadRequest, strings.TrimPrefix(err.Error(), "bad request: "))
	default:
		log.Printf("api error: %v", err)
		writeErr(w, http.StatusInternalServerError, "internal error")
	}
}

func badRequest(msg string) error {
	return fmt.Errorf("%w: %s", errBadRequest, msg)
}

// chartWindow reads from/to (RFC3339) or a legacy hours query. An empty query uses fallback.
func chartWindow(r *http.Request, fallback time.Duration) (time.Time, time.Time, error) {
	now := time.Now().UTC()
	q := r.URL.Query()
	fromRaw, toRaw := strings.TrimSpace(q.Get("from")), strings.TrimSpace(q.Get("to"))
	if fromRaw == "" && toRaw == "" {
		span := fallback
		if raw := strings.TrimSpace(q.Get("hours")); raw != "" {
			hours, err := strconv.Atoi(raw)
			if err != nil || hours < 1 || hours > 24*31 {
				return time.Time{}, time.Time{}, badRequest("hours is outside the allowed range")
			}
			span = time.Duration(hours) * time.Hour
		}
		if span <= 0 {
			span = 24 * time.Hour
		}
		return now.Add(-span), now, nil
	}
	if fromRaw == "" || toRaw == "" {
		return time.Time{}, time.Time{}, badRequest("from and to are both required")
	}
	from, err := time.Parse(time.RFC3339Nano, fromRaw)
	if err != nil {
		return time.Time{}, time.Time{}, badRequest("from is not a valid time")
	}
	to, err := time.Parse(time.RFC3339Nano, toRaw)
	if err != nil {
		return time.Time{}, time.Time{}, badRequest("to is not a valid time")
	}
	from, to = from.UTC(), to.UTC()
	if to.After(now) {
		to = now
	}
	if !to.After(from) {
		return time.Time{}, time.Time{}, badRequest("from must be before to")
	}
	if to.Sub(from) > 31*24*time.Hour {
		return time.Time{}, time.Time{}, badRequest("range is longer than 31 days")
	}
	return from, to, nil
}

func latencyBinSeconds(span time.Duration) int {
	switch {
	case span <= 2*time.Hour:
		return 60
	case span <= 14*time.Hour:
		return 2 * 60
	case span <= 36*time.Hour:
		return 10 * 60
	case span <= 8*24*time.Hour:
		return 60 * 60
	default:
		return 6 * 60 * 60
	}
}

func uptimeBinSeconds(span time.Duration) int {
	switch {
	case span <= 3*time.Hour:
		return 5 * 60
	case span <= 18*time.Hour:
		return 30 * 60
	case span <= 48*time.Hour:
		return 60 * 60
	default:
		return 3 * 60 * 60
	}
}

func metricBinSeconds(span time.Duration) int {
	switch {
	case span <= 2*time.Hour:
		return 60
	case span <= 26*time.Hour:
		return 5 * 60
	case span <= 8*24*time.Hour:
		return 60 * 60
	default:
		return 6 * 60 * 60
	}
}

func decodeJSON(r *http.Request, dest any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	if err := dec.Decode(dest); err != nil {
		return err
	}
	return nil
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func randomToken(prefix string) (plain, hash string, err error) {
	buf := make([]byte, 32)
	if _, err = rand.Read(buf); err != nil {
		return "", "", err
	}
	plain = prefix + hex.EncodeToString(buf)
	return plain, sha256Hex(plain), nil
}

func randomSlug() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func clientIP(r *http.Request) string {
	remote := hostOnly(r.RemoteAddr)
	// Host nginx reaches the published port through Docker's bridge, so RemoteAddr
	// is the gateway (172.20.0.1). Trust the proxy headers only from that private peer.
	if trustForwarded(remote) {
		if ip := headerIP(r.Header.Get("X-Real-IP")); ip != "" {
			return ip
		}
		if ip := lastForwarded(r.Header.Get("X-Forwarded-For")); ip != "" {
			return ip
		}
	}
	return remote
}

func trustForwarded(ip string) bool {
	parsed := net.ParseIP(ip)
	return parsed != nil && (parsed.IsPrivate() || parsed.IsLoopback())
}

func headerIP(raw string) string {
	raw = strings.TrimSpace(raw)
	if i := strings.IndexByte(raw, ','); i >= 0 {
		raw = strings.TrimSpace(raw[:i])
	}
	ip := net.ParseIP(hostOnly(raw))
	if ip == nil {
		return ""
	}
	return ip.String()
}

func lastForwarded(raw string) string {
	parts := strings.Split(raw, ",")
	for i := len(parts) - 1; i >= 0; i-- {
		if ip := headerIP(parts[i]); ip != "" {
			return ip
		}
	}
	return ""
}

func hostOnly(hostport string) string {
	if h, _, err := splitHostPortLoose(hostport); err == nil {
		return h
	}
	return hostport
}

func splitHostPortLoose(hostport string) (string, string, error) {
	// net.SplitHostPort rejects a bare IP. Keep this local to avoid an extra import cycle.
	if strings.HasPrefix(hostport, "[") {
		end := strings.LastIndex(hostport, "]")
		if end < 0 {
			return "", "", fmt.Errorf("invalid")
		}
		host := hostport[1:end]
		rest := hostport[end+1:]
		if strings.HasPrefix(rest, ":") {
			return host, rest[1:], nil
		}
		return host, "", nil
	}
	colon := strings.LastIndex(hostport, ":")
	if colon < 0 {
		return hostport, "", nil
	}
	return hostport[:colon], hostport[colon+1:], nil
}

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	dash := false
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			dash = false
			continue
		}
		if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "group"
	}
	return out
}

func validateEmail(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	if len(s) < 3 || len(s) > 200 || !strings.Contains(s, "@") || strings.ContainsAny(s, " \t\r\n") {
		return "", badRequest("enter a valid email")
	}
	return s, nil
}

func validatePassword(s string) error {
	if len(s) < 8 || len(s) > 200 {
		return badRequest("password must be 8-200 characters")
	}
	return nil
}

func validateName(s, label string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" || utf8.RuneCountInString(s) > 80 {
		return "", badRequest(label + " must be 1-80 characters")
	}
	return s, nil
}

func validateURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
		return "", badRequest("url must be http or https")
	}
	return u.String(), nil
}

var linkPattern = regexp.MustCompile(`https?://[^\s,<>"]+`)

type linkItem struct {
	Name string
	URL  string
	Line int
}

// parseLinkList reads a pasted list or text file. Blank lines and # comments are
// skipped. A line may be a bare host, one or more http(s) links, or a name
// followed by a single link.
func parseLinkList(text string, limit int) ([]linkItem, error) {
	if limit < 1 {
		limit = 1
	}
	text = strings.TrimPrefix(text, "\uFEFF")
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	var items []linkItem
	seen := map[string]struct{}{}
	for i, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		found, err := linksOnLine(line)
		if err != nil {
			return nil, badRequest(fmt.Sprintf("line %d is not a link", i+1))
		}
		for _, raw := range found {
			normalized, err := validateURL(raw.url)
			if err != nil {
				msg := strings.TrimPrefix(err.Error(), "bad request: ")
				return nil, badRequest(fmt.Sprintf("line %d: %s", i+1, msg))
			}
			if _, ok := seen[normalized]; ok {
				continue
			}
			seen[normalized] = struct{}{}
			items = append(items, linkItem{Name: strings.TrimSpace(raw.name), URL: normalized, Line: i + 1})
			if len(items) > limit {
				return nil, badRequest(fmt.Sprintf("at most %d links", limit))
			}
		}
	}
	if len(items) == 0 {
		return nil, badRequest("add at least one link")
	}
	return items, nil
}

type namedLink struct {
	name string
	url  string
}

func linksOnLine(line string) ([]namedLink, error) {
	matches := linkPattern.FindAllStringIndex(line, -1)
	if len(matches) > 0 {
		out := make([]namedLink, 0, len(matches))
		for _, loc := range matches {
			raw := strings.TrimRight(line[loc[0]:loc[1]], ".,);]>'\"")
			name := ""
			if len(matches) == 1 {
				prefix := strings.Trim(strings.TrimSpace(line[:loc[0]]), " \t-|,:;")
				if prefix != "" && !strings.Contains(prefix, "://") {
					name = prefix
				}
			}
			out = append(out, namedLink{name: name, url: raw})
		}
		return out, nil
	}
	parts := strings.FieldsFunc(line, func(r rune) bool { return r == ',' || r == ';' })
	out := make([]namedLink, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.ContainsAny(part, " \t") || !looksLikeHost(part) {
			return nil, errBadRequest
		}
		out = append(out, namedLink{url: "https://" + part})
	}
	if len(out) == 0 {
		return nil, errBadRequest
	}
	return out, nil
}

func looksLikeHost(token string) bool {
	host := token
	if i := strings.IndexAny(host, "/?#"); i >= 0 {
		host = host[:i]
	}
	host = strings.TrimSuffix(host, ".")
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	if host == "" {
		return false
	}
	if strings.EqualFold(host, "localhost") || net.ParseIP(host) != nil {
		return true
	}
	return strings.Contains(host, ".")
}

func linkName(item linkItem) string {
	if name := clipRunes(item.Name, 80); name != "" {
		return name
	}
	u, err := url.Parse(item.URL)
	if err != nil || u.Hostname() == "" {
		return "check"
	}
	if name := clipRunes(u.Hostname(), 80); name != "" {
		return name
	}
	return "check"
}

func clipRunes(s string, n int) string {
	s = strings.TrimSpace(s)
	if s == "" || utf8.RuneCountInString(s) <= n {
		return s
	}
	return strings.TrimSpace(string([]rune(s)[:n]))
}

func validateEndpoint(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", badRequest("agent url must be an http(s) origin")
	}
	return strings.TrimRight(u.String(), "/"), nil
}

func validInstallToken(s string) bool {
	if len(s) < 8 || len(s) > 200 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
		default:
			return false
		}
	}
	return true
}

func validNodeSecret(s string) bool {
	rest, ok := strings.CutPrefix(s, "nd_")
	if !ok || len(rest) != 64 {
		return false
	}
	for _, r := range rest {
		switch {
		case r >= '0' && r <= '9', r >= 'a' && r <= 'f':
		default:
			return false
		}
	}
	return true
}

func normalizeCountries(in []string) ([]string, error) {
	out := make([]string, 0, len(in))
	seen := map[string]bool{}
	for _, c := range in {
		c = strings.ToUpper(strings.TrimSpace(c))
		if c == "" {
			continue
		}
		if len(c) != 2 {
			return nil, badRequest("country codes must be 2 letters")
		}
		for _, r := range c {
			if r < 'A' || r > 'Z' {
				return nil, badRequest("invalid country code")
			}
		}
		if !seen[c] {
			seen[c] = true
			out = append(out, c)
		}
	}
	return out, nil
}

func uniqueStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	out := make([]string, 0, len(in))
	seen := map[string]bool{}
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

func unmarshalGroups(raw []byte) ([]groupRef, error) {
	if len(raw) == 0 {
		return []groupRef{}, nil
	}
	var groups []groupRef
	if err := json.Unmarshal(raw, &groups); err != nil {
		return nil, err
	}
	if groups == nil {
		groups = []groupRef{}
	}
	return groups, nil
}

func asFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	default:
		return 0, false
	}
}

func asInt(v any) (int, bool) {
	f, ok := asFloat(v)
	if !ok {
		return 0, false
	}
	return int(f), true
}

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func asBool(v any) bool {
	b, _ := v.(bool)
	return b
}

func clampText(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func shQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
