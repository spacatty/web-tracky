package server

import (
	"net/http"
	"time"
)

type nodeRow struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Online       bool       `json:"online"`
	LastSeenAt   *time.Time `json:"last_seen_at"`
	CoreVersion  string     `json:"core_version"`
	PackVersion  int        `json:"pack_version"`
	IP           string     `json:"ip,omitempty"`
	Country      string     `json:"country"`
	CountryCode  string     `json:"country_code"`
	City         string     `json:"city"`
	Latitude     *float64   `json:"latitude"`
	Longitude    *float64   `json:"longitude"`
	Adapter      string     `json:"adapter"`
	LinkSpeedBps int64      `json:"link_speed_bps"`
	RxBps        float64    `json:"rx_bps"`
	TxBps        float64    `json:"tx_bps"`
	APIRTTMS     *float64   `json:"api_rtt_ms"`
	Hostname     string     `json:"hostname"`
	OS           string     `json:"os"`
	Arch         string     `json:"arch"`
	Kernel       string     `json:"kernel"`
	Groups       []groupRef `json:"groups"`
	CreatedAt    time.Time  `json:"created_at"`
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
		row, err := scanNode(rows, u.Admin())
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
	hours := 6
	if r.URL.Query().Get("hours") == "24" {
		hours = 24
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT date_trunc('minute', ts), avg(rx_bps), avg(tx_bps), avg(api_rtt_ms)
		FROM node_metrics
		WHERE node_id = $1::uuid AND ts > now() - make_interval(hours => $2)
		GROUP BY 1
		ORDER BY 1`, r.PathValue("id"), hours)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer rows.Close()
	type point struct {
		T        time.Time `json:"t"`
		RxBps    float64   `json:"rx_bps"`
		TxBps    float64   `json:"tx_bps"`
		APIRTTMS *float64  `json:"api_rtt_ms"`
	}
	out := []point{}
	for rows.Next() {
		var p point
		if err := rows.Scan(&p.T, &p.RxBps, &p.TxBps, &p.APIRTTMS); err != nil {
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

func (s *Server) deleteNode(w http.ResponseWriter, r *http.Request) {
	tag, err := s.pool.Exec(r.Context(), `DELETE FROM nodes WHERE id = $1::uuid`, r.PathValue("id"))
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
	return scanNode(rows, u.Admin())
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
	n.api_rtt_ms,
	n.hostname,
	n.os,
	n.arch,
	n.kernel,
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

func scanNode(row nodeScanner, admin bool) (nodeRow, error) {
	var n nodeRow
	var raw []byte
	err := row.Scan(
		&n.ID, &n.Name, &n.Online, &n.LastSeenAt, &n.CoreVersion, &n.PackVersion, &n.IP,
		&n.Country, &n.CountryCode, &n.City, &n.Latitude, &n.Longitude, &n.Adapter,
		&n.LinkSpeedBps, &n.RxBps, &n.TxBps, &n.APIRTTMS, &n.Hostname, &n.OS, &n.Arch,
		&n.Kernel, &n.CreatedAt, &raw,
	)
	if err != nil {
		return n, err
	}
	n.Groups, err = unmarshalGroups(raw)
	if err != nil {
		return n, err
	}
	if !admin {
		n.IP = ""
	}
	return n, nil
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
	var monitorsTotal, monitorsFailing, monitorsOK int
	err = s.pool.QueryRow(r.Context(), `
		SELECT count(*),
			count(*) FILTER (WHERE last_status = 'fail'),
			count(*) FILTER (WHERE last_status = 'ok')
		FROM (
			SELECT m.id,
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
			WHERE $2::bool OR m.owner_id = $1::uuid
		) stats`, u.ID, u.Admin()).Scan(&monitorsTotal, &monitorsFailing, &monitorsOK)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT cr.finished_at, m.id::text, m.name, cr.node_name, cr.city, cr.country_code, cr.http_status, cr.error
		FROM check_results cr
		JOIN monitors m ON m.id = cr.monitor_id
		WHERE cr.status = 'fail' AND ($2::bool OR m.owner_id = $1::uuid)
		ORDER BY cr.finished_at DESC NULLS LAST
		LIMIT 8`, u.ID, u.Admin())
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
	writeJSON(w, http.StatusOK, map[string]any{
		"nodes_online":     nodesOnline,
		"nodes_total":      nodesTotal,
		"monitors_total":   monitorsTotal,
		"monitors_failing": monitorsFailing,
		"monitors_ok":      monitorsOK,
		"recent_failures":  failures,
	})
}
