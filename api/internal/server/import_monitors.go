package server

import (
	"encoding/json"
	"net/http"
	"strings"
)

const maxImportLinks = 200

func (s *Server) importMonitors(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	var body struct {
		Text         string   `json:"text"`
		IntervalSec  int      `json:"interval_sec"`
		Enabled      *bool    `json:"enabled"`
		CountryCodes []string `json:"country_codes"`
		MaxNodes     int      `json:"max_nodes"`
		GroupIDs     []string `json:"group_ids"`
		TemplateID   string   `json:"template_id"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	items, err := parseLinkList(body.Text, maxImportLinks)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	interval := body.IntervalSec
	if interval == 0 {
		interval = 60
	}
	maxNodes := body.MaxNodes
	if maxNodes == 0 {
		maxNodes = 20
	}
	var templatePtr *string
	if strings.TrimSpace(body.TemplateID) != "" {
		id := strings.TrimSpace(body.TemplateID)
		templatePtr = &id
	}
	rules, templateID, err := s.resolveTemplate(r.Context(), templatePtr, nil)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	rulesJSON, err := json.Marshal(rules)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	type ready struct {
		name, target string
		countries    []string
		groups       []string
	}
	prepared := make([]ready, 0, len(items))
	for _, item := range items {
		name, target, countries, groups, err := s.normalizeMonitor(r.Context(), u, linkName(item), item.URL, interval, maxNodes, body.CountryCodes, body.GroupIDs)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		prepared = append(prepared, ready{name: name, target: target, countries: countries, groups: groups})
	}
	var templateArg any
	if templateID != nil {
		templateArg = *templateID
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	for _, item := range prepared {
		var id string
		err = tx.QueryRow(r.Context(), `
			INSERT INTO monitors (owner_id, name, target_url, interval_sec, enabled, country_codes, max_nodes, success_rules, next_run_at, template_id)
			VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::jsonb, now(), $9::uuid)
			RETURNING id::text`,
			u.ID, item.name, item.target, interval, enabled, item.countries, maxNodes, string(rulesJSON), templateArg).Scan(&id)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO monitor_groups (monitor_id, group_id)
			SELECT $1::uuid, id FROM groups WHERE id::text = ANY($2::text[])`, id, item.groups); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]int{"created": len(prepared)})
}
