package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"tracky/api/internal/pack"
)

type statusTemplate struct {
	ID           string             `json:"id"`
	Name         string             `json:"name"`
	SuccessRules []pack.SuccessRule `json:"success_rules"`
	CreatedAt    time.Time          `json:"created_at"`
}

func (s *Server) listTemplates(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, name, success_rules, created_at
		FROM status_templates
		ORDER BY lower(name)`)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()
	out := []statusTemplate{}
	for rows.Next() {
		item, err := scanTemplate(rows)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) createTemplate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name         string             `json:"name"`
		SuccessRules []pack.SuccessRule `json:"success_rules"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	name, rules, err := normalizeTemplate(body.Name, body.SuccessRules)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	raw, err := json.Marshal(rules)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	var id string
	err = s.pool.QueryRow(r.Context(), `
		INSERT INTO status_templates (name, success_rules)
		VALUES ($1, $2::jsonb)
		RETURNING id::text`, name, string(raw)).Scan(&id)
	if err != nil {
		if isUnique(err) {
			writeAPIError(w, badRequest("a preset with that name already exists"))
			return
		}
		writeAPIError(w, err)
		return
	}
	s.writeTemplate(w, r, id, http.StatusCreated)
}

func (s *Server) patchTemplate(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	current, err := s.loadTemplate(r.Context(), id)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	var body struct {
		Name         *string             `json:"name"`
		SuccessRules *[]pack.SuccessRule `json:"success_rules"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	name := current.Name
	rules := current.SuccessRules
	if body.Name != nil {
		name = *body.Name
	}
	if body.SuccessRules != nil {
		rules = *body.SuccessRules
	}
	name, rules, err = normalizeTemplate(name, rules)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	raw, err := json.Marshal(rules)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE status_templates SET name = $2, success_rules = $3::jsonb WHERE id = $1::uuid`, id, name, string(raw))
	if err != nil {
		if isUnique(err) {
			writeAPIError(w, badRequest("a preset with that name already exists"))
			return
		}
		writeAPIError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeAPIError(w, errNotFound)
		return
	}
	s.writeTemplate(w, r, id, http.StatusOK)
}

func (s *Server) deleteTemplate(w http.ResponseWriter, r *http.Request) {
	tag, err := s.pool.Exec(r.Context(), `DELETE FROM status_templates WHERE id = $1::uuid`, r.PathValue("id"))
	if err != nil {
		if isInvalidText(err) {
			writeAPIError(w, errNotFound)
			return
		}
		writeAPIError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeAPIError(w, errNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) writeTemplate(w http.ResponseWriter, r *http.Request, id string, code int) {
	item, err := s.loadTemplate(r.Context(), id)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, code, item)
}

func (s *Server) loadTemplate(ctx context.Context, id string) (statusTemplate, error) {
	var item statusTemplate
	var raw []byte
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, name, success_rules, created_at
		FROM status_templates WHERE id = $1::uuid`, id).Scan(&item.ID, &item.Name, &raw, &item.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isInvalidText(err) {
			return item, errNotFound
		}
		return item, err
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &item.SuccessRules); err != nil {
			return item, err
		}
	}
	if item.SuccessRules == nil {
		item.SuccessRules = []pack.SuccessRule{}
	}
	return item, nil
}

func normalizeTemplate(name string, rules []pack.SuccessRule) (string, []pack.SuccessRule, error) {
	name, err := validateName(name, "name")
	if err != nil {
		return "", nil, err
	}
	normalized, err := pack.NormalizeSuccessRules(rules)
	if err != nil {
		return "", nil, badRequest(err.Error())
	}
	if len(normalized) == 0 {
		return "", nil, badRequest("add at least one success rule")
	}
	return name, normalized, nil
}

// resolveTemplate copies a preset onto a monitor when templateID is set.
// An empty or missing id keeps the rules passed in, which may be the default.
func (s *Server) resolveTemplate(ctx context.Context, templateID *string, rules []pack.SuccessRule) ([]pack.SuccessRule, *string, error) {
	if templateID == nil || strings.TrimSpace(*templateID) == "" {
		normalized, err := pack.NormalizeSuccessRules(rules)
		if err != nil {
			return nil, nil, badRequest(err.Error())
		}
		return normalized, nil, nil
	}
	tpl, err := s.loadTemplate(ctx, strings.TrimSpace(*templateID))
	if err != nil {
		if errors.Is(err, errNotFound) {
			return nil, nil, badRequest("unknown status preset")
		}
		return nil, nil, err
	}
	id := tpl.ID
	return tpl.SuccessRules, &id, nil
}

func scanTemplate(row interface{ Scan(...any) error }) (statusTemplate, error) {
	var item statusTemplate
	var raw []byte
	if err := row.Scan(&item.ID, &item.Name, &raw, &item.CreatedAt); err != nil {
		return item, err
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &item.SuccessRules); err != nil {
			return item, err
		}
	}
	if item.SuccessRules == nil {
		item.SuccessRules = []pack.SuccessRule{}
	}
	return item, nil
}
