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
	"net/http"
	"net/url"
	"strings"
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
	host := r.RemoteAddr
	if h, _, err := splitHostPortLoose(host); err == nil {
		return h
	}
	return host
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
