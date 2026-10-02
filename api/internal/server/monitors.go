package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"tracky/api/internal/pack"
)

type monitorRow struct {
	ID            string             `json:"id"`
	Name          string             `json:"name"`
	TargetURL     string             `json:"target_url"`
	IntervalSec   int                `json:"interval_sec"`
	Enabled       bool               `json:"enabled"`
	PublicEnabled bool               `json:"public_enabled"`
	PublicSlug    *string            `json:"public_slug"`
	CountryCodes  []string           `json:"country_codes"`
	MaxNodes      int                `json:"max_nodes"`
	SuccessRules  []pack.SuccessRule `json:"success_rules"`
	Groups        []groupRef         `json:"groups"`
	LastStatus    string             `json:"last_status"`
	LastCheckedAt *time.Time         `json:"last_checked_at"`
	Uptime24h     *float64           `json:"uptime_24h"`
	OwnerEmail    string             `json:"owner_email,omitempty"`
	CreatedAt     time.Time          `json:"created_at"`
}

type runResult struct {
	ID          string     `json:"id"`
	NodeID      *string    `json:"node_id"`
	NodeName    string     `json:"node_name"`
	City        string     `json:"city"`
	Country     string     `json:"country"`
	CountryCode string     `json:"country_code"`
	Status      string     `json:"status"`
	HTTPStatus  *int       `json:"http_status"`
	TTFBMS      *float64   `json:"ttfb_ms"`
	TotalMS     *float64   `json:"total_ms"`
	PingMS      *float64   `json:"ping_ms"`
	Error       string     `json:"error"`
	FinishedAt  *time.Time `json:"finished_at"`
}

type runView struct {
	ID         string      `json:"id"`
	MonitorID  string      `json:"monitor_id"`
	Trigger    string      `json:"trigger"`
	StartedAt  time.Time   `json:"started_at"`
	FinishedAt *time.Time  `json:"finished_at"`
	Results    []runResult `json:"results"`
}

type latencyPoint struct {
	T       time.Time `json:"t"`
	NodeID  string    `json:"node_id"`
	Label   string    `json:"label"`
	TotalMS float64   `json:"total_ms"`
	OK      bool      `json:"ok"`
}

type uptimeBucket struct {
	T       time.Time `json:"t"`
	OKRatio float64   `json:"ok_ratio"`
}

type monitorDetail struct {
	monitorRow
	LatestRun *runView       `json:"latest_run"`
	Uptime7d  *float64       `json:"uptime_7d"`
	Points    []latencyPoint `json:"points"`
	Buckets   []uptimeBucket `json:"buckets"`
}

func (s *Server) listMonitors(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	rows, err := s.pool.Query(r.Context(), monitorSelectSQL+`
		WHERE $2::bool OR m.owner_id = $1::uuid
		ORDER BY m.name`, u.ID, u.Admin())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()
	out := []monitorRow{}
	for rows.Next() {
		row, err := scanMonitor(rows)
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

func (s *Server) createMonitor(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	var body struct {
		Name          string             `json:"name"`
		TargetURL     string             `json:"target_url"`
		IntervalSec   int                `json:"interval_sec"`
		Enabled       *bool              `json:"enabled"`
		PublicEnabled bool               `json:"public_enabled"`
		CountryCodes  []string           `json:"country_codes"`
		MaxNodes      int                `json:"max_nodes"`
		GroupIDs      []string           `json:"group_ids"`
		SuccessRules  []pack.SuccessRule `json:"success_rules"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	name, target, countries, groups, err := s.normalizeMonitor(r.Context(), u, body.Name, body.TargetURL, body.IntervalSec, body.MaxNodes, body.CountryCodes, body.GroupIDs)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	rules, err := pack.NormalizeSuccessRules(body.SuccessRules)
	if err != nil {
		writeAPIError(w, badRequest(err.Error()))
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
	if body.MaxNodes == 0 {
		body.MaxNodes = 20
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
		INSERT INTO monitors (owner_id, name, target_url, interval_sec, enabled, public_enabled, public_slug, country_codes, max_nodes, success_rules, next_run_at)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now())
		RETURNING id::text`,
		u.ID, name, target, body.IntervalSec, enabled, body.PublicEnabled, slug, countries, body.MaxNodes, string(rulesJSON)).Scan(&id)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO monitor_groups (monitor_id, group_id)
		SELECT $1::uuid, id FROM groups WHERE id::text = ANY($2::text[])`, id, groups); err != nil {
		writeAPIError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, err)
		return
	}
	s.writeMonitor(w, r, id, http.StatusCreated)
}

func (s *Server) getMonitor(w http.ResponseWriter, r *http.Request) {
	if err := s.monitorVisible(r.Context(), r.PathValue("id"), currentUser(r.Context())); err != nil {
		writeAPIError(w, err)
		return
	}
	s.writeMonitor(w, r, r.PathValue("id"), http.StatusOK)
}

func (s *Server) patchMonitor(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	id := r.PathValue("id")
	if err := s.monitorVisible(r.Context(), id, u); err != nil {
		writeAPIError(w, err)
		return
	}
	var body struct {
		Name          *string             `json:"name"`
		TargetURL     *string             `json:"target_url"`
		IntervalSec   *int                `json:"interval_sec"`
		Enabled       *bool               `json:"enabled"`
		PublicEnabled *bool               `json:"public_enabled"`
		CountryCodes  *[]string           `json:"country_codes"`
		MaxNodes      *int                `json:"max_nodes"`
		GroupIDs      *[]string           `json:"group_ids"`
		SuccessRules  *[]pack.SuccessRule `json:"success_rules"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	var current monitorRow
	row, err := s.loadMonitor(r.Context(), id)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	current = row
	name, target := current.Name, current.TargetURL
	interval, maxNodes := current.IntervalSec, current.MaxNodes
	countries := current.CountryCodes
	if body.Name != nil {
		name = *body.Name
	}
	if body.TargetURL != nil {
		target = *body.TargetURL
	}
	if body.IntervalSec != nil {
		interval = *body.IntervalSec
	}
	if body.MaxNodes != nil {
		maxNodes = *body.MaxNodes
	}
	if body.CountryCodes != nil {
		countries = *body.CountryCodes
	}
	var groups []string
	if body.GroupIDs != nil {
		groups = uniqueStrings(*body.GroupIDs)
	} else {
		for _, g := range current.Groups {
			groups = append(groups, g.ID)
		}
	}
	name, target, countries, groups, err = s.normalizeMonitor(r.Context(), u, name, target, interval, maxNodes, countries, groups)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	rules := current.SuccessRules
	if body.SuccessRules != nil {
		rules, err = pack.NormalizeSuccessRules(*body.SuccessRules)
		if err != nil {
			writeAPIError(w, badRequest(err.Error()))
			return
		}
	}
	rulesJSON, err := json.Marshal(rules)
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
	enabled := current.Enabled
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	q := `UPDATE monitors SET name=$2, target_url=$3, interval_sec=$4, enabled=$5, public_enabled=$6, public_slug=$7, country_codes=$8, max_nodes=$9, success_rules=$10::jsonb`
	args := []any{id, name, target, interval, enabled, publicEnabled, slug, countries, maxNodes, string(rulesJSON)}
	if body.Enabled != nil && enabled && !current.Enabled {
		q += `, next_run_at = now()`
	}
	q += ` WHERE id = $1::uuid`
	if _, err := tx.Exec(r.Context(), q, args...); err != nil {
		writeAPIError(w, err)
		return
	}
	if body.GroupIDs != nil {
		if _, err := tx.Exec(r.Context(), `DELETE FROM monitor_groups WHERE monitor_id = $1::uuid`, id); err != nil {
			writeAPIError(w, err)
			return
		}
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO monitor_groups (monitor_id, group_id)
			SELECT $1::uuid, id FROM groups WHERE id::text = ANY($2::text[])`, id, groups); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, err)
		return
	}
	s.writeMonitor(w, r, id, http.StatusOK)
}

func (s *Server) deleteMonitor(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.monitorVisible(r.Context(), id, currentUser(r.Context())); err != nil {
		writeAPIError(w, err)
		return
	}
	tag, err := s.pool.Exec(r.Context(), `DELETE FROM monitors WHERE id = $1::uuid`, id)
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

func (s *Server) checkNow(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.monitorVisible(r.Context(), id, currentUser(r.Context())); err != nil {
		writeAPIError(w, err)
		return
	}
	run, err := s.enqueue(r.Context(), id, "manual")
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

func (s *Server) publicStatus(w http.ResponseWriter, r *http.Request) {
	var id string
	err := s.pool.QueryRow(r.Context(), `
		SELECT id::text FROM monitors WHERE public_slug = $1 AND public_enabled`, r.PathValue("slug")).Scan(&id)
	if err != nil {
		writeAPIError(w, errNotFound)
		return
	}
	detail, err := s.monitorDetail(r.Context(), id)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	detail.OwnerEmail = ""
	writeJSON(w, http.StatusOK, detail)
}

func (s *Server) writeMonitor(w http.ResponseWriter, r *http.Request, id string, code int) {
	detail, err := s.monitorDetail(r.Context(), id)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, code, detail)
}

func (s *Server) monitorDetail(ctx context.Context, id string) (monitorDetail, error) {
	var detail monitorDetail
	row, err := s.loadMonitor(ctx, id)
	if err != nil {
		return detail, err
	}
	detail.monitorRow = row
	run, err := s.latestRun(ctx, id)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return detail, err
	}
	if err == nil {
		detail.LatestRun = &run
	}
	detail.Uptime7d, detail.Points, detail.Buckets, err = s.series(ctx, id, detail.Uptime24h)
	if err != nil {
		return detail, err
	}
	if detail.Points == nil {
		detail.Points = []latencyPoint{}
	}
	if detail.Buckets == nil {
		detail.Buckets = []uptimeBucket{}
	}
	return detail, nil
}

func (s *Server) series(ctx context.Context, id string, uptime24 *float64) (*float64, []latencyPoint, []uptimeBucket, error) {
	var uptime7 *float64
	err := s.pool.QueryRow(ctx, `
		SELECT avg(CASE WHEN status = 'ok' THEN 1.0 ELSE 0 END)
		FROM check_results
		WHERE monitor_id = $1::uuid AND status <> 'pending' AND finished_at > now() - interval '7 days'`, id).Scan(&uptime7)
	if err != nil {
		return nil, nil, nil, err
	}
	_ = uptime24
	rows, err := s.pool.Query(ctx, `
		SELECT finished_at, COALESCE(node_id::text, ''), node_name, city, country_code, total_ms, status = 'ok'
		FROM check_results
		WHERE monitor_id = $1::uuid AND status <> 'pending' AND total_ms IS NOT NULL
		  AND finished_at > now() - interval '24 hours'
		ORDER BY finished_at DESC
		LIMIT 2000`, id)
	if err != nil {
		return nil, nil, nil, err
	}
	defer rows.Close()
	points := []latencyPoint{}
	for rows.Next() {
		var p latencyPoint
		var name, city, code string
		if err := rows.Scan(&p.T, &p.NodeID, &name, &city, &code, &p.TotalMS, &p.OK); err != nil {
			return nil, nil, nil, err
		}
		p.Label = locationLabel(city, code, name)
		points = append(points, p)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, nil, err
	}
	for i, j := 0, len(points)-1; i < j; i, j = i+1, j-1 {
		points[i], points[j] = points[j], points[i]
	}
	brows, err := s.pool.Query(ctx, `
		SELECT date_trunc('hour', finished_at), avg(CASE WHEN status = 'ok' THEN 1.0 ELSE 0 END)
		FROM check_results
		WHERE monitor_id = $1::uuid AND status <> 'pending' AND finished_at > now() - interval '24 hours'
		GROUP BY 1
		ORDER BY 1`, id)
	if err != nil {
		return nil, nil, nil, err
	}
	defer brows.Close()
	buckets := []uptimeBucket{}
	for brows.Next() {
		var b uptimeBucket
		if err := brows.Scan(&b.T, &b.OKRatio); err != nil {
			return nil, nil, nil, err
		}
		buckets = append(buckets, b)
	}
	return uptime7, points, buckets, brows.Err()
}

func (s *Server) latestRun(ctx context.Context, monitorID string) (runView, error) {
	var run runView
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, monitor_id::text, trigger, started_at, finished_at
		FROM check_runs
		WHERE monitor_id = $1::uuid
		ORDER BY started_at DESC
		LIMIT 1`, monitorID).Scan(&run.ID, &run.MonitorID, &run.Trigger, &run.StartedAt, &run.FinishedAt)
	if err != nil {
		return run, err
	}
	results, err := s.runResults(ctx, run.ID)
	if err != nil {
		return run, err
	}
	run.Results = results
	return run, nil
}

func (s *Server) runResults(ctx context.Context, runID string) ([]runResult, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, node_id::text, node_name, city, country, country_code, status,
			http_status, ttfb_ms, total_ms, ping_ms, error, finished_at
		FROM check_results
		WHERE run_id = $1::uuid
		ORDER BY node_name`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []runResult{}
	for rows.Next() {
		var res runResult
		if err := rows.Scan(&res.ID, &res.NodeID, &res.NodeName, &res.City, &res.Country, &res.CountryCode, &res.Status, &res.HTTPStatus, &res.TTFBMS, &res.TotalMS, &res.PingMS, &res.Error, &res.FinishedAt); err != nil {
			return nil, err
		}
		out = append(out, res)
	}
	return out, rows.Err()
}

func (s *Server) loadMonitor(ctx context.Context, id string) (monitorRow, error) {
	rows, err := s.pool.Query(ctx, monitorSelectSQL+` WHERE m.id = $1::uuid`, id)
	if err != nil {
		return monitorRow{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return monitorRow{}, err
		}
		return monitorRow{}, errNotFound
	}
	return scanMonitor(rows)
}

func (s *Server) monitorVisible(ctx context.Context, id string, u User) error {
	var owner string
	err := s.pool.QueryRow(ctx, `SELECT owner_id::text FROM monitors WHERE id = $1::uuid`, id).Scan(&owner)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errNotFound
		}
		return err
	}
	if u.Admin() || owner == u.ID {
		return nil
	}
	return errForbidden
}

func (s *Server) normalizeMonitor(ctx context.Context, u User, name, target string, interval, maxNodes int, countries, groups []string) (string, string, []string, []string, error) {
	name, err := validateName(name, "name")
	if err != nil {
		return "", "", nil, nil, err
	}
	target, err = validateURL(target)
	if err != nil {
		return "", "", nil, nil, err
	}
	if interval < s.cfg.MinCheckIntervalSec || interval > 86400 {
		return "", "", nil, nil, badRequest("interval is outside the allowed range")
	}
	if maxNodes < 1 || maxNodes > 100 {
		return "", "", nil, nil, badRequest("max nodes must be 1-100")
	}
	countries, err = normalizeCountries(countries)
	if err != nil {
		return "", "", nil, nil, err
	}
	groups = uniqueStrings(groups)
	if err := s.assertGroupsUsable(ctx, u, groups); err != nil {
		return "", "", nil, nil, err
	}
	return name, target, countries, groups, nil
}

const monitorSelectSQL = `
SELECT
	m.id::text,
	m.name,
	m.target_url,
	m.interval_sec,
	m.enabled,
	m.public_enabled,
	m.public_slug,
	m.country_codes,
	m.max_nodes,
	m.success_rules,
	m.created_at,
	u.email,
	COALESCE((
		SELECT json_agg(json_build_object('id', g.id::text, 'name', g.name, 'visibility', g.visibility) ORDER BY g.name)
		FROM monitor_groups mg
		JOIN groups g ON g.id = mg.group_id
		WHERE mg.monitor_id = m.id
	), '[]'::json),
	COALESCE(last.last_status, 'unknown'),
	last.last_checked_at,
	up.uptime
FROM monitors m
JOIN users u ON u.id = m.owner_id
LEFT JOIN LATERAL (
	SELECT
		CASE
			WHEN count(*) FILTER (WHERE cr.status = 'pending') > 0 THEN 'pending'
			WHEN count(*) FILTER (WHERE cr.status = 'fail') > 0 THEN 'fail'
			WHEN count(*) FILTER (WHERE cr.status = 'ok') > 0 THEN 'ok'
			ELSE 'unknown'
		END AS last_status,
		r.started_at AS last_checked_at
	FROM check_runs r
	LEFT JOIN check_results cr ON cr.run_id = r.id
	WHERE r.monitor_id = m.id
	GROUP BY r.id, r.started_at
	ORDER BY r.started_at DESC
	LIMIT 1
) last ON true
LEFT JOIN LATERAL (
	SELECT avg(CASE WHEN cr.status = 'ok' THEN 1.0 ELSE 0 END) AS uptime
	FROM check_results cr
	WHERE cr.monitor_id = m.id AND cr.status <> 'pending' AND cr.finished_at > now() - interval '24 hours'
) up ON true
`

func scanMonitor(row interface{ Scan(...any) error }) (monitorRow, error) {
	var m monitorRow
	var rawGroups, rawRules []byte
	err := row.Scan(
		&m.ID, &m.Name, &m.TargetURL, &m.IntervalSec, &m.Enabled, &m.PublicEnabled, &m.PublicSlug,
		&m.CountryCodes, &m.MaxNodes, &rawRules, &m.CreatedAt, &m.OwnerEmail, &rawGroups, &m.LastStatus, &m.LastCheckedAt, &m.Uptime24h,
	)
	if err != nil {
		return m, err
	}
	if m.CountryCodes == nil {
		m.CountryCodes = []string{}
	}
	if len(rawRules) > 0 {
		if err := json.Unmarshal(rawRules, &m.SuccessRules); err != nil {
			return m, err
		}
	}
	if m.SuccessRules == nil {
		m.SuccessRules = []pack.SuccessRule{}
	}
	m.Groups, err = unmarshalGroups(rawGroups)
	return m, err
}

func locationLabel(city, code, name string) string {
	switch {
	case city != "" && code != "":
		return code + " " + city
	case code != "":
		return code
	case city != "":
		return city
	default:
		return name
	}
}
