package server

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

type nodeRow struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	Online         bool            `json:"online"`
	LastSeenAt     *time.Time      `json:"last_seen_at"`
	CoreVersion    string          `json:"core_version"`
	PackVersion    int             `json:"pack_version"`
	IP             string          `json:"ip,omitempty"`
	Country        string          `json:"country"`
	CountryCode    string          `json:"country_code"`
	City           string          `json:"city"`
	Latitude       *float64        `json:"latitude"`
	Longitude      *float64        `json:"longitude"`
	Adapter        string          `json:"adapter"`
	LinkSpeedBps   int64           `json:"link_speed_bps"`
	RxBps          float64         `json:"rx_bps"`
	TxBps          float64         `json:"tx_bps"`
	DownBps        float64         `json:"down_bps"`
	UpBps          float64         `json:"up_bps"`
	SpeedAt        *time.Time      `json:"speed_at"`
	APIRTTMS       *float64        `json:"api_rtt_ms"`
	Hostname       string          `json:"hostname"`
	OS             string          `json:"os"`
	Arch           string          `json:"arch"`
	Kernel         string          `json:"kernel"`
	LastSample     json.RawMessage `json:"last_sample"`
	UpdateStatus   string          `json:"update_status"`
	UpdateTarget   string          `json:"update_target"`
	UpdateError    string          `json:"update_error"`
	UpdateProgress int             `json:"update_progress"`
	UpdateAt       *time.Time      `json:"update_at"`
	CoreLatest     string          `json:"core_latest"`
	Removing       bool            `json:"removing"`
	Groups         []groupRef      `json:"groups"`
	CreatedAt      time.Time       `json:"created_at"`
}

func (s *Server) listNodes(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	rows, err := s.pool.Query(r.Context(), nodeSelectSQL+`
		WHERE $2::bool OR EXISTS (
			SELECT 1 FROM node_groups ng
			JOIN groups g ON g.id = ng.group_id
			WHERE ng.node_id = n.id
			  AND (g.visibility = 'public' OR EXISTS (
				SELECT 1 FROM group_users gu WHERE gu.group_id = g.id AND gu.user_id = $1::uuid
			  ))
		)
		ORDER BY n.name`, u.ID, u.Admin(), s.offlineAfter(r.Context()))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()
	out := []nodeRow{}
	for rows.Next() {
		row, err := scanNode(rows)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		out = append(out, s.finishNode(row))
	}
	if err := rows.Err(); err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) getNode(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	row, err := s.visibleNode(r, r.PathValue("id"), u)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func (s *Server) nodeMetrics(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	if _, err := s.visibleNode(r, r.PathValue("id"), u); err != nil {
		writeAPIError(w, err)
		return
	}
	from, to, err := chartWindow(r, 6*time.Hour)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT date_bin(make_interval(secs => $4), ts, TIMESTAMPTZ '2000-01-01'),
			COALESCE(avg(down_bps), 0), COALESCE(avg(up_bps), 0),
			COALESCE(avg(rx_bps), 0), COALESCE(avg(tx_bps), 0),
			avg(api_rtt_ms)
		FROM node_metrics
		WHERE node_id = $1::uuid AND ts >= $2 AND ts <= $3
		GROUP BY 1
		ORDER BY 1`, r.PathValue("id"), from, to, metricBinSeconds(to.Sub(from)))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()
	type point struct {
		T        time.Time `json:"t"`
		DownBps  float64   `json:"down_bps"`
		UpBps    float64   `json:"up_bps"`
		RxBps    float64   `json:"rx_bps"`
		TxBps    float64   `json:"tx_bps"`
		APIRTTMS *float64  `json:"api_rtt_ms"`
	}
	out := []point{}
	for rows.Next() {
		var p point
		if err := rows.Scan(&p.T, &p.DownBps, &p.UpBps, &p.RxBps, &p.TxBps, &p.APIRTTMS); err != nil {
			writeAPIError(w, err)
			return
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) refreshNodeMetrics(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	tag, err := s.pool.Exec(r.Context(), `UPDATE nodes SET metrics_refresh = true WHERE id = $1::uuid`, id)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeAPIError(w, errNotFound)
		return
	}
	s.waker.Notify(id)
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "queued"})
}

func (s *Server) refreshAllMetrics(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		UPDATE nodes SET metrics_refresh = true
		WHERE last_seen_at IS NOT NULL AND last_seen_at > now() - make_interval(secs => $1)
		RETURNING id::text`, s.offlineAfter(r.Context()))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			writeAPIError(w, err)
			return
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		writeAPIError(w, err)
		return
	}
	for _, id := range ids {
		s.waker.Notify(id)
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"status": "queued", "count": len(ids)})
}

func (s *Server) patchNode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Name           *string   `json:"name"`
		City           *string   `json:"city"`
		Country        *string   `json:"country"`
		CountryCode    *string   `json:"country_code"`
		Latitude       *float64  `json:"latitude"`
		Longitude      *float64  `json:"longitude"`
		LocationLocked *bool     `json:"location_locked"`
		GroupIDs       *[]string `json:"group_ids"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	var exists bool
	if err := s.pool.QueryRow(r.Context(), `SELECT true FROM nodes WHERE id = $1::uuid`, id).Scan(&exists); err != nil {
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
	if body.CountryCode != nil && *body.CountryCode != "" {
		codes, err := normalizeCountries([]string{*body.CountryCode})
		if err != nil {
			writeAPIError(w, err)
			return
		}
		body.CountryCode = &codes[0]
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
	if body.Name != nil {
		if _, err := tx.Exec(r.Context(), `UPDATE nodes SET name = $2, name_locked = true WHERE id = $1::uuid`, id, *body.Name); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	lockLocation := body.City != nil || body.Country != nil || body.CountryCode != nil || body.Latitude != nil || body.Longitude != nil
	if body.City != nil {
		if _, err := tx.Exec(r.Context(), `UPDATE nodes SET city = $2 WHERE id = $1::uuid`, id, *body.City); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if body.Country != nil {
		if _, err := tx.Exec(r.Context(), `UPDATE nodes SET country = $2 WHERE id = $1::uuid`, id, *body.Country); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if body.CountryCode != nil {
		if _, err := tx.Exec(r.Context(), `UPDATE nodes SET country_code = $2 WHERE id = $1::uuid`, id, *body.CountryCode); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if body.Latitude != nil {
		if _, err := tx.Exec(r.Context(), `UPDATE nodes SET latitude = $2 WHERE id = $1::uuid`, id, *body.Latitude); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if body.Longitude != nil {
		if _, err := tx.Exec(r.Context(), `UPDATE nodes SET longitude = $2 WHERE id = $1::uuid`, id, *body.Longitude); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if lockLocation {
		if _, err := tx.Exec(r.Context(), `UPDATE nodes SET location_locked = true WHERE id = $1::uuid`, id); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if body.LocationLocked != nil {
		if _, err := tx.Exec(r.Context(), `UPDATE nodes SET location_locked = $2 WHERE id = $1::uuid`, id, *body.LocationLocked); err != nil {
			writeAPIError(w, err)
			return
		}
	}
	if body.GroupIDs != nil {
		if _, err := tx.Exec(r.Context(), `DELETE FROM node_groups WHERE node_id = $1::uuid`, id); err != nil {
			writeAPIError(w, err)
			return
		}
		if len(groups) > 0 {
			if _, err := tx.Exec(r.Context(), `
				INSERT INTO node_groups (node_id, group_id)
				SELECT $1::uuid, id FROM groups WHERE id::text = ANY($2::text[])`, id, groups); err != nil {
				writeAPIError(w, err)
				return
			}
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, err)
		return
	}
	row, err := s.visibleNode(r, id, currentUser(r.Context()))
	if err != nil {
		writeAPIError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// deleteNode asks an online agent to uninstall itself on its next heartbeat and
// removes the row once that heartbeat is answered. Offline nodes, or agents that
// never pick the order up, are dropped right away or by sweepRemovedNodes.
func (s *Server) deleteNode(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var online bool
	err := s.pool.QueryRow(r.Context(), `
		SELECT last_seen_at IS NOT NULL AND last_seen_at > now() - make_interval(secs => $2)
		FROM nodes WHERE id = $1::uuid`, id, s.offlineAfter(r.Context())).Scan(&online)
	if isNoRows(err) {
		writeAPIError(w, errNotFound)
		return
	}
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if r.URL.Query().Get("force") == "1" || !online {
		if _, err := s.pool.Exec(r.Context(), `DELETE FROM nodes WHERE id = $1::uuid`, id); err != nil {
			writeAPIError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
		return
	}
	if _, err := s.pool.Exec(r.Context(), `UPDATE nodes SET removing_at = COALESCE(removing_at, now()) WHERE id = $1::uuid`, id); err != nil {
		writeAPIError(w, err)
		return
	}
	if _, err := s.pool.Exec(r.Context(), `UPDATE jobs SET status = 'expired' WHERE node_id = $1::uuid AND status = 'queued'`, id); err != nil {
		writeAPIError(w, err)
		return
	}
	s.waker.Notify(id)
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "removing"})
}

func (s *Server) sweepRemovedNodes() {
	if _, err := s.pool.Exec(context.Background(), `DELETE FROM nodes WHERE removing_at < now() - interval '2 minutes'`); err != nil {
		log.Printf("sweep nodes: %v", err)
	}
}

func (s *Server) visibleNode(r *http.Request, id string, u User) (nodeRow, error) {
	rows, err := s.pool.Query(r.Context(), nodeSelectSQL+`
		WHERE n.id = $4::uuid
		  AND ($2::bool OR EXISTS (
			SELECT 1 FROM node_groups ng
			JOIN groups g ON g.id = ng.group_id
			WHERE ng.node_id = n.id
			  AND (g.visibility = 'public' OR EXISTS (
				SELECT 1 FROM group_users gu WHERE gu.group_id = g.id AND gu.user_id = $1::uuid
			  ))
		  ))`, u.ID, u.Admin(), s.offlineAfter(r.Context()), id)
	if err != nil {
		return nodeRow{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return nodeRow{}, err
		}
		return nodeRow{}, errNotFound
	}
	row, err := scanNode(rows)
	if err != nil {
		return nodeRow{}, err
	}
	return s.finishNode(row), nil
}

const nodeSelectSQL = `
SELECT
	n.id::text,
	n.name,
	(n.last_seen_at IS NOT NULL AND n.last_seen_at > now() - make_interval(secs => $3)),
	n.last_seen_at,
	n.core_version,
	n.pack_version,
	n.ip,
	n.country,
	n.country_code,
	n.city,
	n.latitude,
	n.longitude,
	n.adapter,
	n.link_speed_bps,
	n.rx_bps,
	n.tx_bps,
	n.down_bps,
	n.up_bps,
	n.speed_at,
	n.api_rtt_ms,
	n.hostname,
	n.os,
	n.arch,
	n.kernel,
	n.last_sample,
	n.update_status,
	n.update_target,
	n.update_error,
	n.update_progress,
	n.update_at,
	n.removing_at IS NOT NULL,
	n.created_at,
	COALESCE((
		SELECT json_agg(json_build_object('id', g.id::text, 'name', g.name, 'visibility', g.visibility) ORDER BY g.name)
		FROM node_groups ng
		JOIN groups g ON g.id = ng.group_id
		WHERE ng.node_id = n.id
		  AND ($2::bool OR g.visibility = 'public' OR EXISTS (
			SELECT 1 FROM group_users gu WHERE gu.group_id = g.id AND gu.user_id = $1::uuid
		  ))
	), '[]'::json)
FROM nodes n
`

type nodeScanner interface {
	Scan(dest ...any) error
}

func scanNode(row nodeScanner) (nodeRow, error) {
	var n nodeRow
	var raw []byte
	err := row.Scan(
		&n.ID, &n.Name, &n.Online, &n.LastSeenAt, &n.CoreVersion, &n.PackVersion, &n.IP,
		&n.Country, &n.CountryCode, &n.City, &n.Latitude, &n.Longitude, &n.Adapter,
		&n.LinkSpeedBps, &n.RxBps, &n.TxBps, &n.DownBps, &n.UpBps, &n.SpeedAt, &n.APIRTTMS, &n.Hostname, &n.OS, &n.Arch,
		&n.Kernel, &n.LastSample, &n.UpdateStatus, &n.UpdateTarget, &n.UpdateError, &n.UpdateProgress, &n.UpdateAt, &n.Removing, &n.CreatedAt, &raw,
	)
	if err != nil {
		return n, err
	}
	if len(n.LastSample) == 0 {
		n.LastSample = json.RawMessage(`{}`)
	}
	n.Groups, err = unmarshalGroups(raw)
	return n, err
}

func (s *Server) finishNode(n nodeRow) nodeRow {
	if manifest, err := s.loadManifest(); err == nil {
		n.CoreLatest = manifest.Version
	}
	if updateInProgress(n.UpdateStatus) && n.UpdateAt != nil && time.Since(*n.UpdateAt) > 3*time.Minute {
		n.UpdateStatus = "stalled"
	}
	return n
}

func updateInProgress(status string) bool {
	switch status {
	case "downloading", "verifying", "installing", "restarting":
		return true
	default:
		return false
	}
}

func (s *Server) overview(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r.Context())
	offline := s.offlineAfter(r.Context())
	var nodesTotal, nodesOnline int
	err := s.pool.QueryRow(r.Context(), `
		SELECT count(*), count(*) FILTER (WHERE n.last_seen_at > now() - make_interval(secs => $3))
		FROM nodes n
		WHERE $2::bool OR EXISTS (
			SELECT 1 FROM node_groups ng
			JOIN groups g ON g.id = ng.group_id
			WHERE ng.node_id = n.id
			  AND (g.visibility = 'public' OR EXISTS (
				SELECT 1 FROM group_users gu WHERE gu.group_id = g.id AND gu.user_id = $1::uuid
			  ))
		)`, u.ID, u.Admin(), offline).Scan(&nodesTotal, &nodesOnline)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	var monitorsTotal, monitorsFailing, monitorsOK, monitorsPaused int
	err = s.pool.QueryRow(r.Context(), `
		SELECT count(*),
			count(*) FILTER (WHERE last_status = 'fail' AND enabled),
			count(*) FILTER (WHERE last_status = 'ok' AND enabled),
			count(*) FILTER (WHERE NOT enabled)
		FROM (
			SELECT m.id, m.enabled,
				(
					SELECT CASE
						WHEN count(*) FILTER (WHERE cr.status = 'pending') > 0 THEN 'pending'
						WHEN count(*) FILTER (WHERE cr.status = 'fail') > 0 THEN 'fail'
						WHEN count(*) FILTER (WHERE cr.status = 'ok') > 0 THEN 'ok'
						ELSE 'unknown'
					END
					FROM check_runs r
					LEFT JOIN check_results cr ON cr.run_id = r.id
					WHERE r.monitor_id = m.id
					GROUP BY r.id, r.started_at
					ORDER BY r.started_at DESC
					LIMIT 1
				) AS last_status
			FROM monitors m
			WHERE m.kind = 'monitor' AND ($2::bool OR m.owner_id = $1::uuid)
		) stats`, u.ID, u.Admin()).Scan(&monitorsTotal, &monitorsFailing, &monitorsOK, &monitorsPaused)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	checks, err := s.overviewChecks(r.Context(), u)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT cr.finished_at, m.id::text, m.name, cr.node_name, cr.city, cr.country_code, cr.http_status, cr.error
		FROM check_results cr
		JOIN monitors m ON m.id = cr.monitor_id
		WHERE cr.status = 'fail' AND m.kind = 'monitor' AND ($2::bool OR m.owner_id = $1::uuid)
		ORDER BY cr.finished_at DESC NULLS LAST
		LIMIT 60`, u.ID, u.Admin())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()
	type failure struct {
		FinishedAt  *time.Time `json:"finished_at"`
		MonitorID   string     `json:"monitor_id"`
		MonitorName string     `json:"monitor_name"`
		NodeName    string     `json:"node_name"`
		City        string     `json:"city"`
		CountryCode string     `json:"country_code"`
		HTTPStatus  *int       `json:"http_status"`
		Error       string     `json:"error"`
	}
	failures := []failure{}
	for rows.Next() {
		var f failure
		if err := rows.Scan(&f.FinishedAt, &f.MonitorID, &f.MonitorName, &f.NodeName, &f.City, &f.CountryCode, &f.HTTPStatus, &f.Error); err != nil {
			writeAPIError(w, err)
			return
		}
		failures = append(failures, f)
	}
	if err := rows.Err(); err != nil {
		writeAPIError(w, err)
		return
	}
	versionRows, err := s.pool.Query(r.Context(), `
		SELECT COALESCE(NULLIF(n.core_version, ''), 'unknown'),
			count(*),
			count(*) FILTER (WHERE n.last_seen_at IS NOT NULL AND n.last_seen_at > now() - make_interval(secs => $3))
		FROM nodes n
		WHERE $2::bool OR EXISTS (
			SELECT 1 FROM node_groups ng
			JOIN groups g ON g.id = ng.group_id
			WHERE ng.node_id = n.id
			  AND (g.visibility = 'public' OR EXISTS (
				SELECT 1 FROM group_users gu WHERE gu.group_id = g.id AND gu.user_id = $1::uuid
			  ))
		)
		GROUP BY 1
		ORDER BY 2 DESC, 1`, u.ID, u.Admin(), offline)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer versionRows.Close()
	type versionCount struct {
		Version string `json:"version"`
		Count   int    `json:"count"`
		Online  int    `json:"online"`
	}
	versions := []versionCount{}
	for versionRows.Next() {
		var row versionCount
		if err := versionRows.Scan(&row.Version, &row.Count, &row.Online); err != nil {
			writeAPIError(w, err)
			return
		}
		versions = append(versions, row)
	}
	if err := versionRows.Err(); err != nil {
		writeAPIError(w, err)
		return
	}
	var updating, failed int
	err = s.pool.QueryRow(r.Context(), `
		SELECT
			count(*) FILTER (WHERE n.update_status IN ('downloading', 'verifying', 'installing', 'restarting') AND n.update_at > now() - interval '3 minutes'),
			count(*) FILTER (WHERE n.update_status = 'failed')
		FROM nodes n
		WHERE $2::bool OR EXISTS (
			SELECT 1 FROM node_groups ng
			JOIN groups g ON g.id = ng.group_id
			WHERE ng.node_id = n.id
			  AND (g.visibility = 'public' OR EXISTS (
				SELECT 1 FROM group_users gu WHERE gu.group_id = g.id AND gu.user_id = $1::uuid
			  ))
		)`, u.ID, u.Admin()).Scan(&updating, &failed)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	updateRows, err := s.pool.Query(r.Context(), `
		SELECT n.id::text, n.name, n.core_version, n.update_status, n.update_target, n.update_progress, n.update_error
		FROM nodes n
		WHERE n.update_status <> ''
		  AND (n.update_status = 'failed' OR n.update_at > now() - interval '3 minutes')
		  AND ($2::bool OR EXISTS (
			SELECT 1 FROM node_groups ng
			JOIN groups g ON g.id = ng.group_id
			WHERE ng.node_id = n.id
			  AND (g.visibility = 'public' OR EXISTS (
				SELECT 1 FROM group_users gu WHERE gu.group_id = g.id AND gu.user_id = $1::uuid
			  ))
		  ))
		ORDER BY n.update_at DESC NULLS LAST
		LIMIT 12`, u.ID, u.Admin())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer updateRows.Close()
	type updatingNode struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Core     string `json:"core_version"`
		Status   string `json:"update_status"`
		Target   string `json:"update_target"`
		Progress int    `json:"update_progress"`
		Error    string `json:"update_error"`
	}
	updatingNodes := []updatingNode{}
	for updateRows.Next() {
		var row updatingNode
		if err := updateRows.Scan(&row.ID, &row.Name, &row.Core, &row.Status, &row.Target, &row.Progress, &row.Error); err != nil {
			writeAPIError(w, err)
			return
		}
		updatingNodes = append(updatingNodes, row)
	}
	if err := updateRows.Err(); err != nil {
		writeAPIError(w, err)
		return
	}
	monitors, err := s.overviewMonitors(r.Context(), u)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	latest := ""
	if manifest, err := s.loadManifest(); err == nil {
		latest = manifest.Version
	}
	onLatest := 0
	behind := 0
	for _, row := range versions {
		if latest != "" && row.Version == latest {
			onLatest = row.Count
		} else if latest != "" {
			behind += row.Count
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"nodes_online":     nodesOnline,
		"nodes_total":      nodesTotal,
		"monitors_total":   monitorsTotal,
		"monitors_failing": monitorsFailing,
		"monitors_ok":      monitorsOK,
		"monitors_paused":  monitorsPaused,
		"checks":           checks,
		"recent_failures":  failures,
		"agent_latest":     latest,
		"agent_versions":   versions,
		"agents_on_latest": onLatest,
		"agents_behind":    behind,
		"agents_updating":  updating,
		"agents_failed":    failed,
		"updating_agents":  updatingNodes,
		"monitors":         monitors,
	})
}

type checkHour struct {
	T     time.Time `json:"t"`
	OK    int       `json:"ok"`
	Fail  int       `json:"fail"`
	AvgMS *float64  `json:"avg_ms"`
}

type failSpot struct {
	CountryCode string `json:"country_code"`
	City        string `json:"city"`
	Count       int    `json:"count"`
}

type checkSummary struct {
	Total     int         `json:"total"`
	Failed    int         `json:"failed"`
	AvgMS     *float64    `json:"avg_ms"`
	P95MS     *float64    `json:"p95_ms"`
	Hours     []checkHour `json:"hours"`
	FailSpots []failSpot  `json:"fail_spots"`
}

func (s *Server) overviewChecks(ctx context.Context, u User) (checkSummary, error) {
	out := checkSummary{Hours: []checkHour{}, FailSpots: []failSpot{}}
	const scope = `
		FROM check_results cr
		JOIN monitors m ON m.id = cr.monitor_id
		WHERE cr.status <> 'pending' AND cr.finished_at > now() - interval '24 hours'
		  AND m.kind = 'monitor' AND ($2::bool OR m.owner_id = $1::uuid)`
	err := s.pool.QueryRow(ctx, `
		SELECT count(*),
			count(*) FILTER (WHERE cr.status = 'fail'),
			avg(cr.total_ms) FILTER (WHERE cr.status = 'ok'),
			percentile_cont(0.95) WITHIN GROUP (ORDER BY cr.total_ms) FILTER (WHERE cr.status = 'ok')`+scope,
		u.ID, u.Admin()).Scan(&out.Total, &out.Failed, &out.AvgMS, &out.P95MS)
	if err != nil {
		return out, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT date_trunc('hour', cr.finished_at),
			count(*) FILTER (WHERE cr.status = 'ok'),
			count(*) FILTER (WHERE cr.status = 'fail'),
			avg(cr.total_ms) FILTER (WHERE cr.status = 'ok')`+scope+`
		GROUP BY 1
		ORDER BY 1`, u.ID, u.Admin())
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var h checkHour
		if err := rows.Scan(&h.T, &h.OK, &h.Fail, &h.AvgMS); err != nil {
			return out, err
		}
		out.Hours = append(out.Hours, h)
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	spots, err := s.pool.Query(ctx, `
		SELECT cr.country_code, cr.city, count(*)`+scope+` AND cr.status = 'fail'
		GROUP BY 1, 2
		ORDER BY 3 DESC, 1, 2
		LIMIT 6`, u.ID, u.Admin())
	if err != nil {
		return out, err
	}
	defer spots.Close()
	for spots.Next() {
		var f failSpot
		if err := spots.Scan(&f.CountryCode, &f.City, &f.Count); err != nil {
			return out, err
		}
		out.FailSpots = append(out.FailSpots, f)
	}
	return out, spots.Err()
}

type overviewBucket struct {
	T       time.Time `json:"t"`
	OKRatio float64   `json:"ok_ratio"`
	AvgMS   *float64  `json:"avg_ms"`
}

type overviewMonitor struct {
	ID            string           `json:"id"`
	Name          string           `json:"name"`
	TargetURL     string           `json:"target_url"`
	Enabled       bool             `json:"enabled"`
	LastStatus    string           `json:"last_status"`
	LastCheckedAt *time.Time       `json:"last_checked_at"`
	Uptime24h     *float64         `json:"uptime_24h"`
	AvgMS24h      *float64         `json:"avg_ms_24h"`
	Buckets       []overviewBucket `json:"buckets"`
}

func (s *Server) overviewMonitors(ctx context.Context, u User) ([]overviewMonitor, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT m.id::text, m.name, m.target_url, m.enabled,
			COALESCE(last.last_status, 'unknown'),
			last.last_checked_at,
			up.uptime,
			up.avg_ms,
			COALESCE(spark.buckets, '[]'::json)
		FROM monitors m
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
			SELECT avg(CASE WHEN cr.status = 'ok' THEN 1.0 ELSE 0 END) AS uptime,
				avg(cr.total_ms) FILTER (WHERE cr.status = 'ok') AS avg_ms
			FROM check_results cr
			WHERE cr.monitor_id = m.id AND cr.status <> 'pending' AND cr.finished_at > now() - interval '24 hours'
		) up ON true
		LEFT JOIN LATERAL (
			SELECT json_agg(json_build_object('t', s.t, 'ok_ratio', s.ok_ratio, 'avg_ms', s.avg_ms) ORDER BY s.t) AS buckets
			FROM (
				SELECT date_trunc('hour', finished_at) AS t,
					avg(CASE WHEN status = 'ok' THEN 1.0 ELSE 0 END) AS ok_ratio,
					avg(total_ms) FILTER (WHERE status = 'ok') AS avg_ms
				FROM check_results
				WHERE monitor_id = m.id AND status <> 'pending' AND finished_at > now() - interval '24 hours'
				GROUP BY 1
			) s
		) spark ON true
		WHERE m.kind = 'monitor' AND ($2::bool OR m.owner_id = $1::uuid)
		ORDER BY CASE WHEN NOT m.enabled THEN 2 WHEN COALESCE(last.last_status, '') = 'fail' THEN 0 ELSE 1 END, m.name
		LIMIT 50`, u.ID, u.Admin())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []overviewMonitor{}
	for rows.Next() {
		var item overviewMonitor
		var raw []byte
		if err := rows.Scan(&item.ID, &item.Name, &item.TargetURL, &item.Enabled, &item.LastStatus, &item.LastCheckedAt, &item.Uptime24h, &item.AvgMS24h, &raw); err != nil {
			return nil, err
		}
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &item.Buckets); err != nil {
				return nil, err
			}
		}
		if item.Buckets == nil {
			item.Buckets = []overviewBucket{}
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
