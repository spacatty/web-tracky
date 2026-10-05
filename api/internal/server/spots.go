package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type spotTarget struct {
	URL    string   `json:"url"`
	Name   string   `json:"name"`
	Status string   `json:"status"`
	Run    *runView `json:"run"`
}

type spotCheck struct {
	ID           string       `json:"id"`
	TemplateName string       `json:"template_name"`
	CreatedAt    time.Time    `json:"created_at"`
	Groups       []groupRef   `json:"groups"`
	Targets      []spotTarget `json:"targets"`
	Pending      int          `json:"pending"`
	OK           int          `json:"ok"`
	Fail         int          `json:"fail"`
}

type spotSummary struct {
	ID           string    `json:"id"`
	TemplateName string    `json:"template_name"`
	CreatedAt    time.Time `json:"created_at"`
	URLCount     int       `json:"url_count"`
	Pending      int       `json:"pending"`
	OK           int       `json:"ok"`
	Fail         int       `json:"fail"`
}

func (s *Server) listSpotChecks(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	rows, err := s.pool.Query(r.Context(), `
		SELECT s.id::text, s.template_name, s.created_at,
			count(m.id),
			count(m.id) FILTER (WHERE st.status = 'pending'),
			count(m.id) FILTER (WHERE st.status = 'ok'),
			count(m.id) FILTER (WHERE st.status = 'fail')
		FROM spot_checks s
		LEFT JOIN monitors m ON m.spot_id = s.id
		LEFT JOIN LATERAL (
			SELECT CASE
				WHEN count(*) FILTER (WHERE cr.status = 'pending') > 0 THEN 'pending'
				WHEN count(*) FILTER (WHERE cr.status = 'fail') > 0 THEN 'fail'
				WHEN count(*) FILTER (WHERE cr.status = 'ok') > 0 THEN 'ok'
				ELSE 'unknown'
			END AS status
			FROM check_runs r
			LEFT JOIN check_results cr ON cr.run_id = r.id
			WHERE r.monitor_id = m.id
			GROUP BY r.id, r.started_at
			ORDER BY r.started_at DESC
			LIMIT 1
		) st ON true
		WHERE $2::bool OR s.owner_id = $1::uuid
		GROUP BY s.id
		ORDER BY s.created_at DESC
		LIMIT 30`, u.ID, u.Admin())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()
	out := []spotSummary{}
	for rows.Next() {
		var item spotSummary
		if err := rows.Scan(&item.ID, &item.TemplateName, &item.CreatedAt, &item.URLCount, &item.Pending, &item.OK, &item.Fail); err != nil {
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

func (s *Server) getSpotCheck(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.spotVisible(r.Context(), id, currentUser(r.Context())); err != nil {
		writeAPIError(w, err)
		return
	}
	s.writeSpot(w, r, id, http.StatusOK)
}

func (s *Server) createSpotCheck(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	var body struct {
		Text       string   `json:"text"`
		GroupIDs   []string `json:"group_ids"`
		TemplateID string   `json:"template_id"`
		MaxNodes   int      `json:"max_nodes"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	items, err := parseLinkList(body.Text, 0)
	if err != nil {
		writeAPIError(w, err)
		return
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
	rules, _, err := s.resolveTemplate(r.Context(), templatePtr, nil)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	templateName := ""
	if templatePtr != nil {
		tpl, err := s.loadTemplate(r.Context(), *templatePtr)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		templateName = tpl.Name
	}
	rulesJSON, err := json.Marshal(rules)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	type ready struct {
		name, target string
		groups       []string
	}
	prepared := make([]ready, 0, len(items))
	for _, item := range items {
		name, target, _, groups, err := s.normalizeMonitor(r.Context(), u, linkName(item), item.URL, s.cfg.MinCheckIntervalSec, maxNodes, nil, body.GroupIDs)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		prepared = append(prepared, ready{name: name, target: target, groups: groups})
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var spotID string
	err = tx.QueryRow(r.Context(), `
		INSERT INTO spot_checks (owner_id, template_name, success_rules)
		VALUES ($1::uuid, $2, $3::jsonb)
		RETURNING id::text`, u.ID, templateName, string(rulesJSON)).Scan(&spotID)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	var runs []runView
	for i, item := range prepared {
		var monitorID string
		err = tx.QueryRow(r.Context(), `
			INSERT INTO monitors (owner_id, name, target_url, interval_sec, enabled, country_codes, max_nodes, success_rules, next_run_at, kind, spot_id, spot_pos)
			VALUES ($1::uuid, $2, $3, $4, false, '{}', $5, $6::jsonb, now(), 'spot', $7::uuid, $8)
			RETURNING id::text`,
			u.ID, item.name, item.target, s.cfg.MinCheckIntervalSec, maxNodes, string(rulesJSON), spotID, i).Scan(&monitorID)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO monitor_groups (monitor_id, group_id)
			SELECT $1::uuid, id FROM groups WHERE id::text = ANY($2::text[])`, monitorID, item.groups); err != nil {
			writeAPIError(w, err)
			return
		}
		run, err := s.insertRun(r.Context(), tx, monitorID, "manual")
		if err != nil {
			writeAPIError(w, err)
			return
		}
		runs = append(runs, run)
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, err)
		return
	}
	for _, run := range runs {
		s.publishRun(run)
	}
	s.writeSpot(w, r, spotID, http.StatusCreated)
}

func (s *Server) writeSpot(w http.ResponseWriter, r *http.Request, id string, code int) {
	item, err := s.loadSpot(r.Context(), id)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, code, item)
}

func (s *Server) loadSpot(ctx context.Context, id string) (spotCheck, error) {
	var item spotCheck
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, template_name, created_at
		FROM spot_checks WHERE id = $1::uuid`, id).Scan(&item.ID, &item.TemplateName, &item.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isInvalidText(err) {
			return item, errNotFound
		}
		return item, err
	}
	groups, err := s.spotGroups(ctx, id)
	if err != nil {
		return item, err
	}
	item.Groups = groups
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, name, target_url
		FROM monitors
		WHERE spot_id = $1::uuid
		ORDER BY spot_pos, created_at`, id)
	if err != nil {
		return item, err
	}
	defer rows.Close()
	type row struct {
		id, name, url string
	}
	var monitors []row
	for rows.Next() {
		var m row
		if err := rows.Scan(&m.id, &m.name, &m.url); err != nil {
			return item, err
		}
		monitors = append(monitors, m)
	}
	if err := rows.Err(); err != nil {
		return item, err
	}
	item.Targets = []spotTarget{}
	for _, m := range monitors {
		target := spotTarget{URL: m.url, Name: m.name, Status: "unknown"}
		run, err := s.latestRun(ctx, m.id)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return item, err
		}
		if err == nil {
			target.Run = &run
			target.Status = runStatus(&run)
		}
		switch target.Status {
		case "pending":
			item.Pending++
		case "ok":
			item.OK++
		case "fail":
			item.Fail++
		}
		item.Targets = append(item.Targets, target)
	}
	return item, nil
}

func (s *Server) spotGroups(ctx context.Context, id string) ([]groupRef, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT g.id::text, g.name, g.visibility
		FROM monitors m
		JOIN monitor_groups mg ON mg.monitor_id = m.id
		JOIN groups g ON g.id = mg.group_id
		WHERE m.spot_id = $1::uuid
		ORDER BY g.name`, id)
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

func (s *Server) spotVisible(ctx context.Context, id string, u User) error {
	var owner string
	err := s.pool.QueryRow(ctx, `SELECT owner_id::text FROM spot_checks WHERE id = $1::uuid`, id).Scan(&owner)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isInvalidText(err) {
			return errNotFound
		}
		return err
	}
	if u.Admin() || owner == u.ID {
		return nil
	}
	return errForbidden
}

func runStatus(run *runView) string {
	if run == nil {
		return "unknown"
	}
	pending, fail, ok := 0, 0, 0
	for _, res := range run.Results {
		switch res.Status {
		case "pending":
			pending++
		case "fail":
			fail++
		case "ok":
			ok++
		}
	}
	switch {
	case pending > 0:
		return "pending"
	case fail > 0:
		return "fail"
	case ok > 0:
		return "ok"
	default:
		return "unknown"
	}
}
