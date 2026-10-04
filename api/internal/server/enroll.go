package server

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"tracky/api/internal/geo"
)

type tokenRow struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Token     string     `json:"token,omitempty"`
	ExpiresAt *time.Time `json:"expires_at"`
	MaxUses   int        `json:"max_uses"`
	Uses      int        `json:"uses"`
	Revoked   bool       `json:"revoked"`
	Groups    []groupRef `json:"groups"`
	CreatedAt time.Time  `json:"created_at"`
}

func (s *Server) listTokens(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), tokenSelectSQL+`
		ORDER BY t.created_at DESC`)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()
	out := []tokenRow{}
	for rows.Next() {
		row, err := scanToken(rows)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) createToken(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name         string   `json:"name"`
		GroupIDs     []string `json:"group_ids"`
		ExpiresHours int      `json:"expires_hours"`
		MaxUses      int      `json:"max_uses"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	name := body.Name
	if name == "" {
		name = "enroll"
	}
	name, err := validateName(name, "name")
	if err != nil {
		writeAPIError(w, err)
		return
	}
	groups := uniqueStrings(body.GroupIDs)
	if err := s.groupsExist(r.Context(), groups); err != nil {
		writeAPIError(w, err)
		return
	}
	if len(groups) == 0 {
		writeErr(w, http.StatusBadRequest, "select at least one group")
		return
	}
	if body.MaxUses < 0 || body.MaxUses > 1000 {
		writeErr(w, http.StatusBadRequest, "max uses must be 0-1000")
		return
	}
	if body.MaxUses == 0 {
		body.MaxUses = 1
	}
	if body.ExpiresHours < 0 || body.ExpiresHours > 24*365 {
		writeErr(w, http.StatusBadRequest, "expiry is out of range")
		return
	}
	plain, hash, err := randomToken("trk_")
	if err != nil {
		writeAPIError(w, err)
		return
	}
	var expires *time.Time
	if body.ExpiresHours > 0 {
		t := time.Now().Add(time.Duration(body.ExpiresHours) * time.Hour)
		expires = &t
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var id string
	var created time.Time
	err = tx.QueryRow(r.Context(), `
		INSERT INTO enroll_tokens (name, token_hash, token_plain, created_by, expires_at, max_uses)
		VALUES ($1, $2, $3, $4::uuid, $5, $6)
		RETURNING id::text, created_at`,
		name, hash, plain, currentUser(r.Context()).ID, expires, body.MaxUses).Scan(&id, &created)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO enroll_token_groups (token_id, group_id)
		SELECT $1::uuid, id FROM groups WHERE id::text = ANY($2::text[])`, id, groups); err != nil {
		writeAPIError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, err)
		return
	}
	rows, err := s.pool.Query(r.Context(), tokenSelectSQL+` WHERE t.id = $1::uuid`, id)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()
	if !rows.Next() {
		writeAPIError(w, errNotFound)
		return
	}
	row, err := scanToken(rows)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

// Enroll tokens are install-time credentials that only mint node secrets; the
// plaintext is kept so admins can copy the install command again later.
const tokenSelectSQL = `
SELECT t.id::text, t.name, t.token_plain, t.expires_at, t.max_uses, t.uses, t.revoked, t.created_at,
	COALESCE((
		SELECT json_agg(json_build_object('id', g.id::text, 'name', g.name, 'visibility', g.visibility) ORDER BY g.name)
		FROM enroll_token_groups eg
		JOIN groups g ON g.id = eg.group_id
		WHERE eg.token_id = t.id
	), '[]'::json)
FROM enroll_tokens t`

func (s *Server) revokeToken(w http.ResponseWriter, r *http.Request) {
	tag, err := s.pool.Exec(r.Context(), `UPDATE enroll_tokens SET revoked = true WHERE id = $1::uuid`, r.PathValue("id"))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeAPIError(w, errNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func scanToken(row interface{ Scan(...any) error }) (tokenRow, error) {
	var t tokenRow
	var raw []byte
	err := row.Scan(&t.ID, &t.Name, &t.Token, &t.ExpiresAt, &t.MaxUses, &t.Uses, &t.Revoked, &t.CreatedAt, &raw)
	if err != nil {
		return t, err
	}
	t.Groups, err = unmarshalGroups(raw)
	return t, err
}

func (s *Server) enroll(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	var body struct {
		Token      string `json:"token"`
		NodeSecret string `json:"node_secret"`
		Hostname   string `json:"hostname"`
		OS         string `json:"os"`
		Arch       string `json:"arch"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if !validInstallToken(body.Token) {
		s.rejectEnroll(w, ip, "invalid enroll token")
		return
	}
	secret := body.NodeSecret
	if secret == "" {
		var err error
		secret, _, err = randomToken("nd_")
		if err != nil {
			writeAPIError(w, err)
			return
		}
	} else if !validNodeSecret(secret) {
		writeErr(w, http.StatusBadRequest, "invalid node secret")
		return
	}
	secretHash := sha256Hex(secret)
	hostname := body.Hostname
	if hostname == "" {
		hostname = "node"
	}
	if len(hostname) > 80 {
		hostname = hostname[:80]
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer tx.Rollback(r.Context())

	var tokenID string
	var expires *time.Time
	var maxUses, uses int
	var revoked bool
	err = tx.QueryRow(r.Context(), `
		SELECT id::text, expires_at, max_uses, uses, revoked
		FROM enroll_tokens
		WHERE token_hash = $1
		FOR UPDATE`, sha256Hex(body.Token)).Scan(&tokenID, &expires, &maxUses, &uses, &revoked)
	if isNoRows(err) {
		s.rejectEnroll(w, ip, "invalid enroll token")
		return
	}
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if nodeID, ok, err := enrolledNode(r.Context(), tx, secretHash); err != nil {
		writeAPIError(w, err)
		return
	} else if ok {
		if err := tx.Commit(r.Context()); err != nil {
			writeAPIError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"node_id":     nodeID,
			"node_secret": secret,
			"name":        hostname,
		})
		return
	}
	if revoked || (expires != nil && time.Now().After(*expires)) || (maxUses > 0 && uses >= maxUses) {
		writeErr(w, http.StatusUnauthorized, "enroll token is no longer valid")
		return
	}
	var nodeID string
	err = tx.QueryRow(r.Context(), `
		INSERT INTO nodes (name, token_hash, ip, hostname, os, arch)
		VALUES ($1, $2, $3, $1, $4, $5)
		RETURNING id::text`, hostname, secretHash, ip, clampText(body.OS, 40), clampText(body.Arch, 40)).Scan(&nodeID)
	if isUnique(err) {
		nodeID, ok, lookupErr := enrolledNode(r.Context(), s.pool, secretHash)
		if lookupErr != nil {
			writeAPIError(w, lookupErr)
			return
		}
		if !ok {
			writeErr(w, http.StatusConflict, "enroll raced, retry")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"node_id":     nodeID,
			"node_secret": secret,
			"name":        hostname,
		})
		return
	}
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO node_groups (node_id, group_id)
		SELECT $1::uuid, group_id FROM enroll_token_groups WHERE token_id = $2::uuid`, nodeID, tokenID); err != nil {
		writeAPIError(w, err)
		return
	}
	tag, err := tx.Exec(r.Context(), `
		UPDATE enroll_tokens
		SET uses = uses + 1
		WHERE id = $1::uuid AND revoked = false AND uses < max_uses
			AND (expires_at IS NULL OR expires_at > now())`, tokenID)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusUnauthorized, "enroll token is no longer valid")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, err)
		return
	}
	go s.locateNode(nodeID, ip)
	writeJSON(w, http.StatusOK, map[string]string{
		"node_id":     nodeID,
		"node_secret": secret,
		"name":        hostname,
	})
}

// rejectEnroll limits unknown tokens. A real token is already capped by max_uses,
// so a fleet behind one address can enroll together instead of sharing a 20/min bucket.
func (s *Server) rejectEnroll(w http.ResponseWriter, ip, msg string) {
	if !s.enrollHits.allow(ip, 20, time.Minute) {
		log.Printf("enroll rejected: too many attempts ip=%s", ip)
		writeErr(w, http.StatusTooManyRequests, "too many enroll attempts")
		return
	}
	log.Printf("enroll rejected: %s ip=%s", msg, ip)
	writeErr(w, http.StatusUnauthorized, msg)
}

type queryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func enrolledNode(ctx context.Context, q queryRower, secretHash string) (string, bool, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM nodes WHERE token_hash = $1`, secretHash).Scan(&id)
	if isNoRows(err) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return id, true, nil
}

func (s *Server) locateNode(nodeID, ip string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	place, err := geo.Lookup(ctx, s.cfg.GeoLookupURL, ip)
	if err != nil || (place.CountryCode == "" && place.City == "") {
		return
	}
	_, _ = s.pool.Exec(context.Background(), `
		UPDATE nodes
		SET country = $2, country_code = $3, city = $4, latitude = $5, longitude = $6
		WHERE id = $1::uuid AND NOT location_locked`,
		nodeID, place.Country, place.CountryCode, place.City, place.Latitude, place.Longitude)
}
