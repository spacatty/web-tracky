package server

import (
	"context"
	"net/http"
	"time"

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
	rows, err := s.pool.Query(r.Context(), `
		SELECT t.id::text, t.name, t.expires_at, t.max_uses, t.uses, t.revoked, t.created_at,
			COALESCE((
				SELECT json_agg(json_build_object('id', g.id::text, 'name', g.name, 'visibility', g.visibility) ORDER BY g.name)
				FROM enroll_token_groups eg
				JOIN groups g ON g.id = eg.group_id
				WHERE eg.token_id = t.id
			), '[]'::json)
		FROM enroll_tokens t
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
		INSERT INTO enroll_tokens (name, token_hash, created_by, expires_at, max_uses)
		VALUES ($1, $2, $3::uuid, $4, $5)
		RETURNING id::text, created_at`,
		name, hash, currentUser(r.Context()).ID, expires, body.MaxUses).Scan(&id, &created)
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
	rows, err := s.pool.Query(r.Context(), `
		SELECT t.id::text, t.name, t.expires_at, t.max_uses, t.uses, t.revoked, t.created_at,
			COALESCE((
				SELECT json_agg(json_build_object('id', g.id::text, 'name', g.name, 'visibility', g.visibility) ORDER BY g.name)
				FROM enroll_token_groups eg
				JOIN groups g ON g.id = eg.group_id
				WHERE eg.token_id = t.id
			), '[]'::json)
		FROM enroll_tokens t WHERE t.id = $1::uuid`, id)
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
	row.Token = plain
	writeJSON(w, http.StatusCreated, row)
}

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
	err := row.Scan(&t.ID, &t.Name, &t.ExpiresAt, &t.MaxUses, &t.Uses, &t.Revoked, &t.CreatedAt, &raw)
	if err != nil {
		return t, err
	}
	t.Groups, err = unmarshalGroups(raw)
	return t, err
}

func (s *Server) enroll(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !s.enrollHits.allow(ip, 20, time.Minute) {
		writeErr(w, http.StatusTooManyRequests, "too many enroll attempts")
		return
	}
	var body struct {
		Token    string `json:"token"`
		Hostname string `json:"hostname"`
		OS       string `json:"os"`
		Arch     string `json:"arch"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if !validInstallToken(body.Token) {
		writeErr(w, http.StatusUnauthorized, "invalid enroll token")
		return
	}
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
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid enroll token")
		return
	}
	if revoked || (expires != nil && time.Now().After(*expires)) || (maxUses > 0 && uses >= maxUses) {
		writeErr(w, http.StatusUnauthorized, "enroll token is no longer valid")
		return
	}
	secret, secretHash, err := randomToken("nd_")
	if err != nil {
		writeAPIError(w, err)
		return
	}
	var nodeID string
	err = tx.QueryRow(r.Context(), `
		INSERT INTO nodes (name, token_hash, ip, hostname, os, arch)
		VALUES ($1, $2, $3, $1, $4, $5)
		RETURNING id::text`, hostname, secretHash, ip, clampText(body.OS, 40), clampText(body.Arch, 40)).Scan(&nodeID)
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
	if _, err := tx.Exec(r.Context(), `UPDATE enroll_tokens SET uses = uses + 1 WHERE id = $1::uuid`, tokenID); err != nil {
		writeAPIError(w, err)
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
