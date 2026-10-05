package server

import (
	"context"
	"crypto/hmac"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

// Monitor folders are what the panel calls "groups". The name "groups" is
// already taken by node pools (groups / monitor_groups tables).

var folderColors = map[string]bool{
	"slate": true, "red": true, "orange": true, "amber": true, "lime": true, "emerald": true,
	"teal": true, "sky": true, "blue": true, "indigo": true, "violet": true, "pink": true,
}

var folderIcons = map[string]bool{
	"folder": true, "globe": true, "server": true, "database": true, "cart": true, "shield": true,
	"zap": true, "cloud": true, "code": true, "briefcase": true, "heart": true, "star": true,
}

const maxBulkMonitors = 500

type folderRow struct {
	ID            string    `json:"id"`
	OwnerID       string    `json:"owner_id"`
	OwnerEmail    string    `json:"owner_email"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	Color         string    `json:"color"`
	Icon          string    `json:"icon"`
	Position      int       `json:"position"`
	PublicEnabled bool      `json:"public_enabled"`
	PublicSlug    *string   `json:"public_slug"`
	Protected     bool      `json:"public_protected"`
	MonitorCount  int       `json:"monitor_count"`
	CreatedAt     time.Time `json:"created_at"`
}

const folderSelectSQL = `
SELECT f.id::text, f.owner_id::text, u.email, f.name, f.description, f.color, f.icon, f.position,
	f.public_enabled, f.public_slug, f.public_password_hash <> '',
	(SELECT count(*) FROM monitors m WHERE m.folder_id = f.id AND m.kind = 'monitor')::int,
	f.created_at
FROM monitor_folders f
JOIN users u ON u.id = f.owner_id
`

func scanFolder(row interface{ Scan(...any) error }) (folderRow, error) {
	var f folderRow
	err := row.Scan(&f.ID, &f.OwnerID, &f.OwnerEmail, &f.Name, &f.Description, &f.Color, &f.Icon, &f.Position,
		&f.PublicEnabled, &f.PublicSlug, &f.Protected, &f.MonitorCount, &f.CreatedAt)
	return f, err
}

func (s *Server) loadFolder(ctx context.Context, id string) (folderRow, error) {
	f, err := scanFolder(s.pool.QueryRow(ctx, folderSelectSQL+` WHERE f.id = $1::uuid`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isInvalidText(err) {
			return f, errNotFound
		}
		return f, err
	}
	return f, nil
}

func (s *Server) visibleFolder(ctx context.Context, id string, u User) (folderRow, error) {
	f, err := s.loadFolder(ctx, id)
	if err != nil {
		return f, err
	}
	if !u.Admin() && f.OwnerID != u.ID {
		return f, errNotFound
	}
	return f, nil
}

// resolveFolder validates a folder id for a monitor owned by ownerID. An empty id means no folder.
func (s *Server) resolveFolder(ctx context.Context, ownerID, raw string) (*string, error) {
	id := strings.TrimSpace(raw)
	if id == "" {
		return nil, nil
	}
	var owner string
	err := s.pool.QueryRow(ctx, `SELECT owner_id::text FROM monitor_folders WHERE id = $1::uuid`, id).Scan(&owner)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isInvalidText(err) {
			return nil, badRequest("unknown group")
		}
		return nil, err
	}
	if owner != ownerID {
		return nil, badRequest("the group belongs to a different user than the monitor")
	}
	return &id, nil
}

func normalizeFolder(name, description, color, icon string) (string, string, string, string, error) {
	name, err := validateName(name, "group name")
	if err != nil {
		return "", "", "", "", err
	}
	description = strings.TrimSpace(description)
	if utf8.RuneCountInString(description) > 280 {
		return "", "", "", "", badRequest("description must be at most 280 characters")
	}
	if color == "" {
		color = "slate"
	}
	if !folderColors[color] {
		return "", "", "", "", badRequest("unknown color")
	}
	if icon == "" {
		icon = "folder"
	}
	if !folderIcons[icon] {
		return "", "", "", "", badRequest("unknown icon")
	}
	return name, description, color, icon, nil
}

func (s *Server) listFolders(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	rows, err := s.pool.Query(r.Context(), folderSelectSQL+`
		WHERE $2::bool OR f.owner_id = $1::uuid
		ORDER BY f.position, lower(f.name)`, u.ID, u.Admin())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()
	out := []folderRow{}
	for rows.Next() {
		f, err := scanFolder(rows)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) getFolder(w http.ResponseWriter, r *http.Request) {
	f, err := s.visibleFolder(r.Context(), r.PathValue("id"), currentUser(r.Context()))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (s *Server) createFolder(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	var body struct {
		Name           string   `json:"name"`
		Description    string   `json:"description"`
		Color          string   `json:"color"`
		Icon           string   `json:"icon"`
		PublicEnabled  bool     `json:"public_enabled"`
		PublicPassword string   `json:"public_password"`
		MonitorIDs     []string `json:"monitor_ids"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	name, description, color, icon, err := normalizeFolder(body.Name, body.Description, body.Color, body.Icon)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	hash, err := hashStatusPassword(body.PublicPassword)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	var slug *string
	if body.PublicEnabled {
		value, err := randomSlug()
		if err != nil {
			writeAPIError(w, err)
			return
		}
		slug = &value
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var id string
	err = tx.QueryRow(r.Context(), `
		INSERT INTO monitor_folders (owner_id, name, description, color, icon, position, public_enabled, public_slug, public_password_hash)
		VALUES ($1::uuid, $2, $3, $4, $5,
			(SELECT COALESCE(max(position) + 1, 0) FROM monitor_folders WHERE owner_id = $1::uuid),
			$6, $7, $8)
		RETURNING id::text`, u.ID, name, description, color, icon, body.PublicEnabled, slug, hash).Scan(&id)
	if err != nil {
		if isUnique(err) {
			writeAPIError(w, badRequest("you already have a group with that name"))
			return
		}
		writeAPIError(w, err)
		return
	}
	if body.MonitorIDs != nil {
		if err := setFolderMembers(r.Context(), tx, id, u.ID, body.MonitorIDs); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, err)
		return
	}
	s.writeFolder(w, r, id, http.StatusCreated)
}

func (s *Server) patchFolder(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	current, err := s.visibleFolder(r.Context(), r.PathValue("id"), u)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	var body struct {
		Name           *string   `json:"name"`
		Description    *string   `json:"description"`
		Color          *string   `json:"color"`
		Icon           *string   `json:"icon"`
		PublicEnabled  *bool     `json:"public_enabled"`
		PublicPassword *string   `json:"public_password"`
		MonitorIDs     *[]string `json:"monitor_ids"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	name, description, color, icon := current.Name, current.Description, current.Color, current.Icon
	if body.Name != nil {
		name = *body.Name
	}
	if body.Description != nil {
		description = *body.Description
	}
	if body.Color != nil {
		color = *body.Color
	}
	if body.Icon != nil {
		icon = *body.Icon
	}
	name, description, color, icon, err = normalizeFolder(name, description, color, icon)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	publicEnabled := current.PublicEnabled
	if body.PublicEnabled != nil {
		publicEnabled = *body.PublicEnabled
	}
	slug := current.PublicSlug
	if publicEnabled && (slug == nil || *slug == "") {
		value, err := randomSlug()
		if err != nil {
			writeAPIError(w, err)
			return
		}
		slug = &value
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	q := `UPDATE monitor_folders SET name = $2, description = $3, color = $4, icon = $5, public_enabled = $6, public_slug = $7`
	args := []any{current.ID, name, description, color, icon, publicEnabled, slug}
	if body.PublicPassword != nil {
		hash, err := hashStatusPassword(*body.PublicPassword)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		args = append(args, hash)
		q += fmt.Sprintf(`, public_password_hash = $%d`, len(args))
	}
	q += ` WHERE id = $1::uuid`
	if _, err := tx.Exec(r.Context(), q, args...); err != nil {
		if isUnique(err) {
			writeAPIError(w, badRequest("you already have a group with that name"))
			return
		}
		writeAPIError(w, err)
		return
	}
	if body.MonitorIDs != nil {
		if err := setFolderMembers(r.Context(), tx, current.ID, current.OwnerID, *body.MonitorIDs); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, err)
		return
	}
	s.writeFolder(w, r, current.ID, http.StatusOK)
}

// setFolderMembers makes ids the exact member list. Monitors that leave become ungrouped;
// monitors that join leave whatever group they were in before.
func setFolderMembers(ctx context.Context, tx pgx.Tx, folderID, ownerID string, ids []string) error {
	ids = uniqueStrings(ids)
	if len(ids) > maxBulkMonitors {
		return badRequest(fmt.Sprintf("a group can hold at most %d monitors at once", maxBulkMonitors))
	}
	var n int
	if err := tx.QueryRow(ctx, `
		SELECT count(*) FROM monitors
		WHERE id::text = ANY($1::text[]) AND owner_id = $2::uuid AND kind = 'monitor'`, ids, ownerID).Scan(&n); err != nil {
		return err
	}
	if n != len(ids) {
		return badRequest("some monitors cannot be added to this group")
	}
	if _, err := tx.Exec(ctx, `
		UPDATE monitors SET folder_id = NULL
		WHERE folder_id = $1::uuid AND NOT (id::text = ANY($2::text[]))`, folderID, ids); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE monitors SET folder_id = $1::uuid WHERE id::text = ANY($2::text[])`, folderID, ids)
	return err
}

func (s *Server) deleteFolder(w http.ResponseWriter, r *http.Request) {
	f, err := s.visibleFolder(r.Context(), r.PathValue("id"), currentUser(r.Context()))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if _, err := s.pool.Exec(r.Context(), `DELETE FROM monitor_folders WHERE id = $1::uuid`, f.ID); err != nil {
		writeAPIError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) reorderFolders(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	ids := uniqueStrings(body.IDs)
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	for i, id := range ids {
		if _, err := tx.Exec(r.Context(), `
			UPDATE monitor_folders SET position = $2
			WHERE id::text = $1 AND ($4::bool OR owner_id = $3::uuid)`, id, i, u.ID, u.Admin()); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) writeFolder(w http.ResponseWriter, r *http.Request, id string, code int) {
	f, err := s.loadFolder(r.Context(), id)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, code, f)
}

func (s *Server) bulkMonitors(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	var body struct {
		IDs      []string `json:"ids"`
		Action   string   `json:"action"`
		FolderID string   `json:"folder_id"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	ids := uniqueStrings(body.IDs)
	if len(ids) == 0 {
		writeAPIError(w, badRequest("select at least one monitor"))
		return
	}
	if len(ids) > maxBulkMonitors {
		writeAPIError(w, badRequest(fmt.Sprintf("at most %d monitors at once", maxBulkMonitors)))
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, owner_id::text FROM monitors
		WHERE id::text = ANY($1::text[]) AND kind = 'monitor'`, ids)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	owners := map[string]string{}
	for rows.Next() {
		var id, owner string
		if err := rows.Scan(&id, &owner); err != nil {
			rows.Close()
			writeAPIError(w, err)
			return
		}
		owners[id] = owner
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		writeAPIError(w, err)
		return
	}
	if len(owners) != len(ids) {
		writeAPIError(w, errNotFound)
		return
	}
	if !u.Admin() {
		for _, owner := range owners {
			if owner != u.ID {
				writeAPIError(w, errForbidden)
				return
			}
		}
	}
	ctx := r.Context()
	result := map[string]int{"affected": len(ids)}
	switch body.Action {
	case "pause", "resume":
		enabled := body.Action == "resume"
		_, err = s.pool.Exec(ctx, `
			UPDATE monitors
			SET next_run_at = CASE WHEN $2::bool AND NOT enabled THEN now() ELSE next_run_at END,
				enabled = $2::bool
			WHERE id::text = ANY($1::text[])`, ids, enabled)
	case "move":
		var folderID *string
		if strings.TrimSpace(body.FolderID) != "" {
			f, ferr := s.visibleFolder(ctx, strings.TrimSpace(body.FolderID), u)
			if ferr != nil {
				if errors.Is(ferr, errNotFound) {
					ferr = badRequest("unknown group")
				}
				writeAPIError(w, ferr)
				return
			}
			for _, owner := range owners {
				if owner != f.OwnerID {
					writeAPIError(w, badRequest("some monitors belong to a different user than the group"))
					return
				}
			}
			folderID = &f.ID
		}
		_, err = s.pool.Exec(ctx, `UPDATE monitors SET folder_id = $2::uuid WHERE id::text = ANY($1::text[])`, ids, folderID)
	case "delete":
		_, err = s.pool.Exec(ctx, `DELETE FROM monitors WHERE id::text = ANY($1::text[])`, ids)
	case "check":
		idle := 0
		for _, id := range ids {
			run, rerr := s.enqueue(ctx, id, "manual")
			if rerr != nil {
				writeAPIError(w, rerr)
				return
			}
			if len(run.Results) == 0 {
				idle++
			}
		}
		result["no_nodes"] = idle
	default:
		writeAPIError(w, badRequest("unknown action"))
		return
	}
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

type publicGroupBucket struct {
	T       time.Time `json:"t"`
	OKRatio float64   `json:"ok_ratio"`
	AvgMS   *float64  `json:"avg_ms"`
}

type publicGroupMonitor struct {
	ID            string              `json:"id"`
	Name          string              `json:"name"`
	TargetURL     string              `json:"target_url"`
	Enabled       bool                `json:"enabled"`
	LastStatus    string              `json:"last_status"`
	LastCheckedAt *time.Time          `json:"last_checked_at"`
	Uptime        *float64            `json:"uptime"`
	AvgMS         *float64            `json:"avg_ms"`
	PublicSlug    *string             `json:"public_slug"`
	Buckets       []publicGroupBucket `json:"buckets"`
}

type publicGroup struct {
	Name        string               `json:"name"`
	Description string               `json:"description"`
	Color       string               `json:"color"`
	Icon        string               `json:"icon"`
	From        time.Time            `json:"from"`
	To          time.Time            `json:"to"`
	BinSec      int                  `json:"bin_sec"`
	Uptime      *float64             `json:"uptime"`
	Monitors    []publicGroupMonitor `json:"monitors"`
}

func groupStatusKey(slug string) string { return "group:" + slug }

func (s *Server) publicFolder(w http.ResponseWriter, r *http.Request) (folderRow, bool) {
	slug := r.PathValue("slug")
	var id, hash string
	err := s.pool.QueryRow(r.Context(), `
		SELECT id::text, public_password_hash FROM monitor_folders WHERE public_slug = $1 AND public_enabled`, slug).Scan(&id, &hash)
	if err != nil {
		writeAPIError(w, errNotFound)
		return folderRow{}, false
	}
	if hash != "" {
		token := r.Header.Get("X-Status-Token")
		if token == "" || !hmac.Equal([]byte(token), []byte(s.statusToken(groupStatusKey(slug), hash))) {
			writeErr(w, http.StatusUnauthorized, "password required")
			return folderRow{}, false
		}
	}
	f, err := s.loadFolder(r.Context(), id)
	if err != nil {
		writeAPIError(w, err)
		return folderRow{}, false
	}
	return f, true
}

func (s *Server) unlockGroupStatus(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if !s.statusHits.allow(clientIP(r)+"|"+groupStatusKey(slug), 10, time.Minute) {
		writeErr(w, http.StatusTooManyRequests, "too many attempts, wait a minute")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	var hash string
	err := s.pool.QueryRow(r.Context(), `
		SELECT public_password_hash FROM monitor_folders WHERE public_slug = $1 AND public_enabled`, slug).Scan(&hash)
	if err != nil {
		writeAPIError(w, errNotFound)
		return
	}
	if hash == "" {
		writeJSON(w, http.StatusOK, map[string]string{"token": ""})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.Password)) != nil {
		writeErr(w, http.StatusUnauthorized, "wrong password")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": s.statusToken(groupStatusKey(slug), hash)})
}

func groupBinSeconds(span time.Duration) int {
	bin := int(span.Seconds()/60+59) / 60 * 60
	if bin < 300 {
		bin = 300
	}
	return bin
}

func (s *Server) publicGroupStatus(w http.ResponseWriter, r *http.Request) {
	f, ok := s.publicFolder(w, r)
	if !ok {
		return
	}
	from, to, err := chartWindow(r, 24*time.Hour)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	ctx := r.Context()
	rows, err := s.pool.Query(ctx, monitorSelectSQL+`
		WHERE m.folder_id = $1::uuid AND m.kind = 'monitor'
		ORDER BY lower(m.name)`, f.ID)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	out := publicGroup{
		Name: f.Name, Description: f.Description, Color: f.Color, Icon: f.Icon,
		From: from, To: to, BinSec: groupBinSeconds(to.Sub(from)),
		Monitors: []publicGroupMonitor{},
	}
	index := map[string]int{}
	ids := []string{}
	for rows.Next() {
		m, err := scanMonitor(rows)
		if err != nil {
			rows.Close()
			writeAPIError(w, err)
			return
		}
		item := publicGroupMonitor{
			ID: m.ID, Name: m.Name, TargetURL: m.TargetURL, Enabled: m.Enabled,
			LastStatus: m.LastStatus, LastCheckedAt: m.LastCheckedAt, Buckets: []publicGroupBucket{},
		}
		if m.PublicEnabled && m.PublicSlug != nil {
			item.PublicSlug = m.PublicSlug
		}
		index[m.ID] = len(out.Monitors)
		ids = append(ids, m.ID)
		out.Monitors = append(out.Monitors, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		writeAPIError(w, err)
		return
	}
	if len(ids) > 0 {
		brows, err := s.pool.Query(ctx, `
			SELECT monitor_id::text,
				date_bin(make_interval(secs => $2), finished_at, TIMESTAMPTZ '2000-01-01'),
				avg(CASE WHEN status = 'ok' THEN 1.0 ELSE 0 END),
				avg(total_ms)
			FROM check_results
			WHERE monitor_id = ANY($1::text[]::uuid[]) AND status <> 'pending'
			  AND finished_at >= $3 AND finished_at <= $4
			GROUP BY 1, 2
			ORDER BY 2`, ids, out.BinSec, from, to)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		for brows.Next() {
			var id string
			var b publicGroupBucket
			if err := brows.Scan(&id, &b.T, &b.OKRatio, &b.AvgMS); err != nil {
				brows.Close()
				writeAPIError(w, err)
				return
			}
			if i, ok := index[id]; ok {
				out.Monitors[i].Buckets = append(out.Monitors[i].Buckets, b)
			}
		}
		brows.Close()
		if err := brows.Err(); err != nil {
			writeAPIError(w, err)
			return
		}
		urows, err := s.pool.Query(ctx, `
			SELECT monitor_id::text, avg(CASE WHEN status = 'ok' THEN 1.0 ELSE 0 END), avg(total_ms)
			FROM check_results
			WHERE monitor_id = ANY($1::text[]::uuid[]) AND status <> 'pending'
			  AND finished_at >= $2 AND finished_at <= $3
			GROUP BY 1`, ids, from, to)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		for urows.Next() {
			var id string
			var uptime, avg *float64
			if err := urows.Scan(&id, &uptime, &avg); err != nil {
				urows.Close()
				writeAPIError(w, err)
				return
			}
			if i, ok := index[id]; ok {
				out.Monitors[i].Uptime = uptime
				out.Monitors[i].AvgMS = avg
			}
		}
		urows.Close()
		if err := urows.Err(); err != nil {
			writeAPIError(w, err)
			return
		}
		if err := s.pool.QueryRow(ctx, `
			SELECT avg(CASE WHEN status = 'ok' THEN 1.0 ELSE 0 END)
			FROM check_results
			WHERE monitor_id = ANY($1::text[]::uuid[]) AND status <> 'pending'
			  AND finished_at >= $2 AND finished_at <= $3`, ids, from, to).Scan(&out.Uptime); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, out)
}
