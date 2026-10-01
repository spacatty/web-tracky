package server

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

type userRow struct {
	ID        string     `json:"id"`
	Email     string     `json:"email"`
	Role      string     `json:"role"`
	Groups    []groupRef `json:"groups"`
	CreatedAt time.Time  `json:"created_at"`
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		SELECT u.id::text, u.email, u.role, u.created_at,
			COALESCE((
				SELECT json_agg(json_build_object('id', g.id::text, 'name', g.name, 'visibility', g.visibility) ORDER BY g.name)
				FROM group_users gu
				JOIN groups g ON g.id = gu.group_id
				WHERE gu.user_id = u.id
			), '[]'::json)
		FROM users u
		ORDER BY u.email`)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()
	out := []userRow{}
	for rows.Next() {
		var row userRow
		var raw []byte
		if err := rows.Scan(&row.ID, &row.Email, &row.Role, &row.CreatedAt, &raw); err != nil {
			writeAPIError(w, err)
			return
		}
		row.Groups, err = unmarshalGroups(raw)
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

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string   `json:"email"`
		Password string   `json:"password"`
		Role     string   `json:"role"`
		GroupIDs []string `json:"group_ids"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	email, err := validateEmail(body.Email)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if err := validatePassword(body.Password); err != nil {
		writeAPIError(w, err)
		return
	}
	if body.Role != "admin" && body.Role != "user" {
		writeErr(w, http.StatusBadRequest, "role must be admin or user")
		return
	}
	groups := uniqueStrings(body.GroupIDs)
	if err := s.groupsExist(r.Context(), groups); err != nil {
		writeAPIError(w, err)
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var id string
	err = tx.QueryRow(r.Context(), `
		INSERT INTO users (email, password_hash, role)
		VALUES ($1, $2, $3)
		RETURNING id::text`, email, string(hash), body.Role).Scan(&id)
	if err != nil {
		if isUnique(err) {
			writeErr(w, http.StatusConflict, "an account with that email already exists")
			return
		}
		writeAPIError(w, err)
		return
	}
	if err := replaceUserGroups(r.Context(), tx, id, groups); err != nil {
		writeAPIError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, err)
		return
	}
	s.writeUser(w, r, id, http.StatusCreated)
}

func (s *Server) patchUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Password *string   `json:"password"`
		Role     *string   `json:"role"`
		GroupIDs *[]string `json:"group_ids"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	var role string
	err := s.pool.QueryRow(r.Context(), `SELECT role FROM users WHERE id = $1::uuid`, id).Scan(&role)
	if err != nil {
		writeAPIError(w, errNotFound)
		return
	}
	if body.Role != nil && *body.Role != "admin" && *body.Role != "user" {
		writeErr(w, http.StatusBadRequest, "role must be admin or user")
		return
	}
	if body.Role != nil && role == "admin" && *body.Role != "admin" {
		if err := s.keepAnAdmin(r.Context(), id); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if body.Password != nil {
		if err := validatePassword(*body.Password); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	var groups []string
	if body.GroupIDs != nil {
		groups = uniqueStrings(*body.GroupIDs)
		if err := s.groupsExist(r.Context(), groups); err != nil {
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
	if body.Role != nil {
		if _, err := tx.Exec(r.Context(), `UPDATE users SET role = $2 WHERE id = $1::uuid`, id, *body.Role); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if body.Password != nil {
		hash, err := bcrypt.GenerateFromPassword([]byte(*body.Password), bcrypt.DefaultCost)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		if _, err := tx.Exec(r.Context(), `UPDATE users SET password_hash = $2 WHERE id = $1::uuid`, id, string(hash)); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if body.GroupIDs != nil {
		if err := replaceUserGroups(r.Context(), tx, id, groups); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, err)
		return
	}
	s.writeUser(w, r, id, http.StatusOK)
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == currentUser(r.Context()).ID {
		writeErr(w, http.StatusBadRequest, "you cannot delete your own account")
		return
	}
	var role string
	err := s.pool.QueryRow(r.Context(), `SELECT role FROM users WHERE id = $1::uuid`, id).Scan(&role)
	if err != nil {
		writeAPIError(w, errNotFound)
		return
	}
	if role == "admin" {
		if err := s.keepAnAdmin(r.Context(), id); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	tag, err := s.pool.Exec(r.Context(), `DELETE FROM users WHERE id = $1::uuid`, id)
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

func (s *Server) keepAnAdmin(ctx context.Context, exceptID string) error {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE role = 'admin' AND id <> $1::uuid`, exceptID).Scan(&n)
	if err != nil {
		return err
	}
	if n == 0 {
		return badRequest("at least one admin is required")
	}
	return nil
}

func (s *Server) writeUser(w http.ResponseWriter, r *http.Request, id string, code int) {
	var row userRow
	var raw []byte
	err := s.pool.QueryRow(r.Context(), `
		SELECT u.id::text, u.email, u.role, u.created_at,
			COALESCE((
				SELECT json_agg(json_build_object('id', g.id::text, 'name', g.name, 'visibility', g.visibility) ORDER BY g.name)
				FROM group_users gu
				JOIN groups g ON g.id = gu.group_id
				WHERE gu.user_id = u.id
			), '[]'::json)
		FROM users u WHERE u.id = $1::uuid`, id).Scan(&row.ID, &row.Email, &row.Role, &row.CreatedAt, &raw)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	row.Groups, err = unmarshalGroups(raw)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, code, row)
}

func replaceUserGroups(ctx context.Context, tx pgx.Tx, userID string, groupIDs []string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM group_users WHERE user_id = $1::uuid`, userID); err != nil {
		return err
	}
	if len(groupIDs) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO group_users (group_id, user_id)
		SELECT id, $2::uuid FROM groups WHERE id::text = ANY($1::text[])`, groupIDs, userID)
	return err
}
