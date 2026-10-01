package server

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

type groupRow struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Slug        string    `json:"slug"`
	Visibility  string    `json:"visibility"`
	Description string    `json:"description"`
	UserCount   int       `json:"user_count"`
	NodeCount   int       `json:"node_count"`
	CreatedAt   time.Time `json:"created_at"`
	Users       []idName  `json:"users,omitempty"`
	Nodes       []idName  `json:"nodes,omitempty"`
}

type idName struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Online *bool  `json:"online,omitempty"`
}

func (s *Server) listGroups(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	rows, err := s.pool.Query(r.Context(), `
		SELECT g.id::text, g.name, g.slug, g.visibility, g.description, g.created_at,
			(SELECT count(*) FROM group_users gu WHERE gu.group_id = g.id),
			(SELECT count(*) FROM node_groups ng WHERE ng.group_id = g.id)
		FROM groups g
		WHERE $2::bool OR g.visibility = 'public' OR EXISTS (
			SELECT 1 FROM group_users gu WHERE gu.group_id = g.id AND gu.user_id = $1::uuid
		)
		ORDER BY g.name`, u.ID, u.Admin())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()
	out := []groupRow{}
	for rows.Next() {
		var row groupRow
		if err := rows.Scan(&row.ID, &row.Name, &row.Slug, &row.Visibility, &row.Description, &row.CreatedAt, &row.UserCount, &row.NodeCount); err != nil {
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

func (s *Server) getGroup(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	row, err := s.loadGroup(r.Context(), r.PathValue("id"), u)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func (s *Server) createGroup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string   `json:"name"`
		Visibility  string   `json:"visibility"`
		Description string   `json:"description"`
		UserIDs     []string `json:"user_ids"`
		NodeIDs     []string `json:"node_ids"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	name, err := validateName(body.Name, "name")
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if body.Visibility != "public" && body.Visibility != "private" {
		writeErr(w, http.StatusBadRequest, "visibility must be public or private")
		return
	}
	if len(body.Description) > 500 {
		writeErr(w, http.StatusBadRequest, "description is too long")
		return
	}
	users := uniqueStrings(body.UserIDs)
	nodes := uniqueStrings(body.NodeIDs)
	if err := s.usersExist(r.Context(), users); err != nil {
		writeAPIError(w, err)
		return
	}
	if err := s.nodesExist(r.Context(), nodes); err != nil {
		writeAPIError(w, err)
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	slug, err := s.uniqueSlug(r.Context(), tx, slugify(name))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	var id string
	err = tx.QueryRow(r.Context(), `
		INSERT INTO groups (name, slug, visibility, description)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text`, name, slug, body.Visibility, body.Description).Scan(&id)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if err := replaceGroupUsers(r.Context(), tx, id, users); err != nil {
		writeAPIError(w, err)
		return
	}
	if err := replaceGroupNodes(r.Context(), tx, id, nodes); err != nil {
		writeAPIError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, err)
		return
	}
	row, err := s.loadGroup(r.Context(), id, currentUser(r.Context()))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

func (s *Server) patchGroup(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Name        *string   `json:"name"`
		Visibility  *string   `json:"visibility"`
		Description *string   `json:"description"`
		UserIDs     *[]string `json:"user_ids"`
		NodeIDs     *[]string `json:"node_ids"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	var exists bool
	if err := s.pool.QueryRow(r.Context(), `SELECT true FROM groups WHERE id = $1::uuid`, id).Scan(&exists); err != nil {
		writeAPIError(w, errNotFound)
		return
	}
	if body.Name != nil {
		name, err := validateName(*body.Name, "name")
		if err != nil {
			writeAPIError(w, err)
			return
		}
		body.Name = &name
	}
	if body.Visibility != nil && *body.Visibility != "public" && *body.Visibility != "private" {
		writeErr(w, http.StatusBadRequest, "visibility must be public or private")
		return
	}
	if body.Description != nil && len(*body.Description) > 500 {
		writeErr(w, http.StatusBadRequest, "description is too long")
		return
	}
	var users, nodes []string
	if body.UserIDs != nil {
		users = uniqueStrings(*body.UserIDs)
		if err := s.usersExist(r.Context(), users); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if body.NodeIDs != nil {
		nodes = uniqueStrings(*body.NodeIDs)
		if err := s.nodesExist(r.Context(), nodes); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if body.Name != nil {
		if _, err := tx.Exec(r.Context(), `UPDATE groups SET name = $2 WHERE id = $1::uuid`, id, *body.Name); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if body.Visibility != nil {
		if _, err := tx.Exec(r.Context(), `UPDATE groups SET visibility = $2 WHERE id = $1::uuid`, id, *body.Visibility); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if body.Description != nil {
		if _, err := tx.Exec(r.Context(), `UPDATE groups SET description = $2 WHERE id = $1::uuid`, id, *body.Description); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if body.UserIDs != nil {
		if err := replaceGroupUsers(r.Context(), tx, id, users); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if body.NodeIDs != nil {
		if err := replaceGroupNodes(r.Context(), tx, id, nodes); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, err)
		return
	}
	row, err := s.loadGroup(r.Context(), id, currentUser(r.Context()))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func (s *Server) deleteGroup(w http.ResponseWriter, r *http.Request) {
	tag, err := s.pool.Exec(r.Context(), `DELETE FROM groups WHERE id = $1::uuid`, r.PathValue("id"))
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

func (s *Server) loadGroup(ctx context.Context, id string, u User) (groupRow, error) {
	var row groupRow
	err := s.pool.QueryRow(ctx, `
		SELECT g.id::text, g.name, g.slug, g.visibility, g.description, g.created_at,
			(SELECT count(*) FROM group_users gu WHERE gu.group_id = g.id),
			(SELECT count(*) FROM node_groups ng WHERE ng.group_id = g.id)
		FROM groups g
		WHERE g.id = $1::uuid
		  AND ($3::bool OR g.visibility = 'public' OR EXISTS (
			SELECT 1 FROM group_users gu WHERE gu.group_id = g.id AND gu.user_id = $2::uuid
		  ))`, id, u.ID, u.Admin()).Scan(
		&row.ID, &row.Name, &row.Slug, &row.Visibility, &row.Description, &row.CreatedAt, &row.UserCount, &row.NodeCount)
	if err != nil {
		return row, errNotFound
	}
	offline := s.offlineAfter(ctx)
	nrows, err := s.pool.Query(ctx, `
		SELECT n.id::text, n.name, (n.last_seen_at IS NOT NULL AND n.last_seen_at > now() - make_interval(secs => $2))
		FROM nodes n
		JOIN node_groups ng ON ng.node_id = n.id
		WHERE ng.group_id = $1::uuid
		ORDER BY n.name`, id, offline)
	if err != nil {
		return row, err
	}
	defer nrows.Close()
	row.Nodes = []idName{}
	for nrows.Next() {
		var n idName
		var online bool
		if err := nrows.Scan(&n.ID, &n.Name, &online); err != nil {
			return row, err
		}
		n.Online = &online
		row.Nodes = append(row.Nodes, n)
	}
	if err := nrows.Err(); err != nil {
		return row, err
	}
	if u.Admin() {
		urows, err := s.pool.Query(ctx, `
			SELECT u.id::text, u.email
			FROM users u
			JOIN group_users gu ON gu.user_id = u.id
			WHERE gu.group_id = $1::uuid
			ORDER BY u.email`, id)
		if err != nil {
			return row, err
		}
		defer urows.Close()
		row.Users = []idName{}
		for urows.Next() {
			var user idName
			if err := urows.Scan(&user.ID, &user.Name); err != nil {
				return row, err
			}
			row.Users = append(row.Users, user)
		}
		if err := urows.Err(); err != nil {
			return row, err
		}
	}
	return row, nil
}

func (s *Server) uniqueSlug(ctx context.Context, tx pgx.Tx, base string) (string, error) {
	slug := base
	for i := 2; i < 100; i++ {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT exists(SELECT 1 FROM groups WHERE slug = $1)`, slug).Scan(&exists); err != nil {
			return "", err
		}
		if !exists {
			return slug, nil
		}
		slug = base + "-" + itoa(i)
	}
	return "", badRequest("could not allocate a group slug")
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func (s *Server) groupsExist(ctx context.Context, ids []string) error {
	return s.idsExist(ctx, `SELECT count(*) FROM groups WHERE id::text = ANY($1::text[])`, ids, "group")
}

func (s *Server) usersExist(ctx context.Context, ids []string) error {
	return s.idsExist(ctx, `SELECT count(*) FROM users WHERE id::text = ANY($1::text[])`, ids, "user")
}

func (s *Server) nodesExist(ctx context.Context, ids []string) error {
	return s.idsExist(ctx, `SELECT count(*) FROM nodes WHERE id::text = ANY($1::text[])`, ids, "node")
}

func (s *Server) idsExist(ctx context.Context, query string, ids []string, label string) error {
	if len(ids) == 0 {
		return nil
	}
	var n int
	if err := s.pool.QueryRow(ctx, query, ids).Scan(&n); err != nil {
		return err
	}
	if n != len(ids) {
		return badRequest("unknown " + label)
	}
	return nil
}

func (s *Server) assertGroupsUsable(ctx context.Context, u User, ids []string) error {
	if len(ids) == 0 {
		return badRequest("select at least one group")
	}
	var n int
	err := s.pool.QueryRow(ctx, `
		SELECT count(*) FROM groups g
		WHERE g.id::text = ANY($1::text[])
		  AND ($2::bool OR g.visibility = 'public' OR EXISTS (
			SELECT 1 FROM group_users gu WHERE gu.group_id = g.id AND gu.user_id = $3::uuid
		  ))`, ids, u.Admin(), u.ID).Scan(&n)
	if err != nil {
		return err
	}
	if n != len(ids) {
		return badRequest("one or more groups are not available")
	}
	return nil
}

func replaceGroupUsers(ctx context.Context, tx pgx.Tx, groupID string, userIDs []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM group_users WHERE group_id = $1::uuid`, groupID); err != nil {
		return err
	}
	if len(userIDs) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO group_users (group_id, user_id)
		SELECT $1::uuid, id FROM users WHERE id::text = ANY($2::text[])`, groupID, userIDs)
	return err
}

func replaceGroupNodes(ctx context.Context, tx pgx.Tx, groupID string, nodeIDs []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM node_groups WHERE group_id = $1::uuid`, groupID); err != nil {
		return err
	}
	if len(nodeIDs) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO node_groups (group_id, node_id)
		SELECT $1::uuid, id FROM nodes WHERE id::text = ANY($2::text[])`, groupID, nodeIDs)
	return err
}
