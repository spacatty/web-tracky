package server

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

const sessionTTL = 14 * 24 * time.Hour

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Registration != "open" {
		writeErr(w, http.StatusForbidden, "registration is closed")
		return
	}
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
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
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	var id string
	err = s.pool.QueryRow(r.Context(), `
		INSERT INTO users (email, password_hash, role)
		VALUES ($1, $2, 'user')
		RETURNING id::text`, email, string(hash)).Scan(&id)
	if err != nil {
		if isUnique(err) {
			writeErr(w, http.StatusConflict, "an account with that email already exists")
			return
		}
		writeAPIError(w, err)
		return
	}
	if err := s.startSession(w, r, id); err != nil {
		writeAPIError(w, err)
		return
	}
	s.writeMe(w, r.WithContext(withUser(r.Context(), User{ID: id, Email: email, Role: "user"})))
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	email, err := validateEmail(body.Email)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	var id, hash, role string
	err = s.pool.QueryRow(r.Context(), `SELECT id::text, password_hash, role FROM users WHERE email = $1`, email).Scan(&id, &hash, &role)
	if err != nil {
		_ = bcrypt.CompareHashAndPassword(s.dummyHash, []byte(body.Password))
		writeErr(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.Password)) != nil {
		writeErr(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if err := s.startSession(w, r, id); err != nil {
		writeAPIError(w, err)
		return
	}
	s.writeMe(w, r.WithContext(withUser(r.Context(), User{ID: id, Email: email, Role: role})))
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		_, _ = s.pool.Exec(r.Context(), `DELETE FROM sessions WHERE token_hash = $1`, sha256Hex(c.Value))
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   strings.HasPrefix(s.cfg.AppPublicURL, "https://"),
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	s.writeMe(w, r)
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := validatePassword(body.NewPassword); err != nil {
		writeAPIError(w, err)
		return
	}
	u := currentUser(r.Context())
	var hash string
	err := s.pool.QueryRow(r.Context(), `SELECT password_hash FROM users WHERE id = $1::uuid`, u.ID).Scan(&hash)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.CurrentPassword)) != nil {
		writeErr(w, http.StatusUnauthorized, "current password is incorrect")
		return
	}
	next, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if _, err := s.pool.Exec(r.Context(), `UPDATE users SET password_hash = $2 WHERE id = $1::uuid`, u.ID, string(next)); err != nil {
		writeAPIError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, userID string) error {
	plain, hash, err := randomToken("ses_")
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO sessions (user_id, token_hash, expires_at)
		VALUES ($1::uuid, $2, $3)`, userID, hash, time.Now().Add(sessionTTL))
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    plain,
		Path:     "/",
		Expires:  time.Now().Add(sessionTTL),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   strings.HasPrefix(s.cfg.AppPublicURL, "https://"),
	})
	return nil
}

func (s *Server) userFromRequest(r *http.Request) (User, error) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return User{}, errForbidden
	}
	var u User
	err = s.pool.QueryRow(r.Context(), `
		SELECT u.id::text, u.email, u.role
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.expires_at > now()`, sha256Hex(c.Value)).Scan(&u.ID, &u.Email, &u.Role)
	if err != nil {
		return User{}, err
	}
	return u, nil
}

func (s *Server) writeMe(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	groups, err := s.userGroups(r.Context(), u.ID)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":     u.ID,
		"email":  u.Email,
		"role":   u.Role,
		"groups": groups,
	})
}

func (s *Server) userGroups(ctx context.Context, userID string) ([]groupRef, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT g.id::text, g.name, g.visibility
		FROM group_users gu
		JOIN groups g ON g.id = gu.group_id
		WHERE gu.user_id = $1::uuid
		ORDER BY g.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []groupRef{}
	for rows.Next() {
		var g groupRef
		if err := rows.Scan(&g.ID, &g.Name, &g.Visibility); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func isUnique(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func isInvalidText(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "22P02"
}

var _ = pgx.ErrNoRows
