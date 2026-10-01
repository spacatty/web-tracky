package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

type jobInfo struct {
	ID    string          `json:"id"`
	Steps json.RawMessage `json:"steps"`
}

func (s *Server) heartbeat(w http.ResponseWriter, r *http.Request) {
	nodeID, err := s.nodeFromRequest(r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var body struct {
		CoreVersion string         `json:"core_version"`
		PackVersion int            `json:"pack_version"`
		APIRTTMS    *float64       `json:"api_rtt_ms"`
		GOOS        string         `json:"goos"`
		GOARCH      string         `json:"goarch"`
		Metrics     map[string]any `json:"metrics"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	doc, raw, err := s.syncPack(r.Context())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if err := s.recordHeartbeat(r, nodeID, body.CoreVersion, body.PackVersion, body.APIRTTMS, body.GOOS, body.GOARCH, body.Metrics); err != nil {
		writeAPIError(w, err)
		return
	}

	heldStart := time.Now()
	deadline := heldStart.Add(time.Duration(doc.HeartbeatSec) * time.Second)
	var jobs []jobInfo
	for {
		jobs, err = s.leaseJobs(r.Context(), nodeID)
		if err != nil {
			writeAPIError(w, err)
			return
		}
		if len(jobs) > 0 || !time.Now().Before(deadline) || r.Context().Err() != nil {
			break
		}
		s.waker.Wait(nodeID, time.Until(deadline), r.Context())
	}
	if jobs == nil {
		jobs = []jobInfo{}
	}
	packPayload := map[string]any{
		"version":  doc.Version,
		"core_min": doc.CoreMin,
	}
	if body.PackVersion != doc.Version {
		packPayload["document"] = json.RawMessage(raw)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"node_id":       nodeID,
		"held_ms":       time.Since(heldStart).Milliseconds(),
		"heartbeat_sec": doc.HeartbeatSec,
		"core":          s.coreInfo(body.GOOS, body.GOARCH),
		"pack":          packPayload,
		"jobs":          jobs,
	})
}

func (s *Server) recordHeartbeat(r *http.Request, nodeID, core string, packVersion int, rtt *float64, goos, goarch string, metrics map[string]any) error {
	if metrics == nil {
		metrics = map[string]any{}
	}
	sample, err := json.Marshal(metrics)
	if err != nil {
		return err
	}
	netSample := asMap(metrics["net"])
	hostSample := asMap(metrics["host"])
	rx, _ := asFloat(netSample["rx_bps"])
	tx, _ := asFloat(netSample["tx_bps"])
	link, _ := asFloat(netSample["link_speed_bps"])
	adapter, _ := netSample["adapter"].(string)
	hostname, _ := hostSample["hostname"].(string)
	osName, _ := hostSample["os"].(string)
	arch, _ := hostSample["arch"].(string)
	kernel, _ := hostSample["kernel"].(string)
	if osName == "" {
		osName = goos
	}
	if arch == "" {
		arch = goarch
	}
	ip := clientIP(r)
	var prevIP string
	var locked bool
	err = s.pool.QueryRow(r.Context(), `SELECT ip, location_locked FROM nodes WHERE id = $1::uuid`, nodeID).Scan(&prevIP, &locked)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(r.Context(), `
		UPDATE nodes SET
			last_seen_at = now(),
			core_version = $2,
			pack_version = $3,
			ip = $4,
			adapter = $5,
			link_speed_bps = $6,
			rx_bps = $7,
			tx_bps = $8,
			api_rtt_ms = $9,
			hostname = CASE WHEN $10 = '' THEN hostname ELSE $10 END,
			os = CASE WHEN $11 = '' THEN os ELSE $11 END,
			arch = CASE WHEN $12 = '' THEN arch ELSE $12 END,
			kernel = CASE WHEN $13 = '' THEN kernel ELSE $13 END,
			last_sample = $14::jsonb
		WHERE id = $1::uuid`,
		nodeID, clampText(core, 40), packVersion, ip, clampText(adapter, 64), int64(link), rx, tx, rtt,
		clampText(hostname, 80), clampText(osName, 40), clampText(arch, 40), clampText(kernel, 80), string(sample))
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO node_metrics (node_id, rx_bps, tx_bps, link_speed_bps, api_rtt_ms)
		VALUES ($1::uuid, $2, $3, $4, $5)`, nodeID, rx, tx, int64(link), rtt)
	if err != nil {
		return err
	}
	if ip != prevIP && !locked {
		go s.locateNode(nodeID, ip)
	}
	return nil
}

func (s *Server) leaseJobs(ctx context.Context, nodeID string) ([]jobInfo, error) {
	rows, err := s.pool.Query(ctx, `
		WITH picked AS (
			SELECT id FROM jobs
			WHERE node_id = $1::uuid AND status = 'queued'
			ORDER BY created_at
			LIMIT 5
			FOR UPDATE SKIP LOCKED
		)
		UPDATE jobs j
		SET status = 'leased', leased_at = now()
		FROM picked
		WHERE j.id = picked.id
		RETURNING j.id::text, j.program`, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []jobInfo{}
	for rows.Next() {
		var job jobInfo
		if err := rows.Scan(&job.ID, &job.Steps); err != nil {
			return nil, err
		}
		out = append(out, job)
	}
	return out, rows.Err()
}

func (s *Server) postResult(w http.ResponseWriter, r *http.Request) {
	nodeID, err := s.nodeFromRequest(r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var body struct {
		JobID string         `json:"job_id"`
		OK    bool           `json:"ok"`
		Error string         `json:"error"`
		Saves map[string]any `json:"saves"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var resultID, runID, monitorID, status string
	err = tx.QueryRow(r.Context(), `
		SELECT result_id::text, run_id::text, monitor_id::text, status
		FROM jobs
		WHERE id = $1::uuid AND node_id = $2::uuid
		FOR UPDATE`, body.JobID, nodeID).Scan(&resultID, &runID, &monitorID, &status)
	if err != nil {
		writeErr(w, http.StatusNotFound, "unknown job")
		return
	}
	if status == "done" {
		_ = tx.Commit(r.Context())
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}
	if status == "expired" {
		writeErr(w, http.StatusConflict, "job expired")
		return
	}
	httpSave := asMap(body.Saves["http"])
	pingSave := asMap(body.Saves["ping"])
	resultStatus := "fail"
	errText := clampText(body.Error, 500)
	var httpStatus *int
	var ttfb, total, ping *float64
	if httpSave != nil {
		if asBool(httpSave["ok"]) {
			resultStatus = "ok"
			errText = ""
		} else if msg, _ := httpSave["error"].(string); msg != "" && errText == "" {
			errText = clampText(msg, 500)
		}
		if n, ok := asInt(httpSave["status"]); ok {
			httpStatus = &n
		}
		if n, ok := asFloat(httpSave["ttfb_ms"]); ok {
			ttfb = &n
		}
		if n, ok := asFloat(httpSave["total_ms"]); ok {
			total = &n
		}
	} else if errText == "" {
		errText = "missing http result"
	}
	_ = body.OK
	if pingSave != nil {
		if n, ok := asFloat(pingSave["rtt_ms"]); ok {
			ping = &n
		}
	}
	var result runResult
	err = tx.QueryRow(r.Context(), `
		UPDATE check_results
		SET status = $2, http_status = $3, ttfb_ms = $4, total_ms = $5, ping_ms = $6, error = $7, finished_at = now()
		WHERE id = $1::uuid
		RETURNING id::text, node_id::text, node_name, city, country, country_code, status, http_status, ttfb_ms, total_ms, ping_ms, error, finished_at`,
		resultID, resultStatus, httpStatus, ttfb, total, ping, errText).Scan(
		&result.ID, &result.NodeID, &result.NodeName, &result.City, &result.Country, &result.CountryCode,
		&result.Status, &result.HTTPStatus, &result.TTFBMS, &result.TotalMS, &result.PingMS, &result.Error, &result.FinishedAt)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE jobs SET status = 'done' WHERE id = $1::uuid`, body.JobID); err != nil {
		writeAPIError(w, err)
		return
	}
	var finished *time.Time
	err = tx.QueryRow(r.Context(), `
		UPDATE check_runs SET finished_at = now()
		WHERE id = $1::uuid AND finished_at IS NULL
		  AND NOT EXISTS (SELECT 1 FROM check_results WHERE run_id = $1::uuid AND status = 'pending')
		RETURNING finished_at`, runID).Scan(&finished)
	runFinished := err == nil
	if err != nil && !isNoRows(err) {
		writeAPIError(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeAPIError(w, err)
		return
	}
	s.broker.Publish(monitorID, "result", map[string]any{
		"run_id":       runID,
		"monitor_id":   monitorID,
		"result":       result,
		"run_finished": runFinished,
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) nodeFromRequest(r *http.Request) (string, error) {
	header := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(header) <= len(prefix) || header[:len(prefix)] != prefix {
		return "", errForbidden
	}
	var id string
	err := s.pool.QueryRow(r.Context(), `SELECT id::text FROM nodes WHERE token_hash = $1`, sha256Hex(header[len(prefix):])).Scan(&id)
	if err != nil {
		return "", err
	}
	return id, nil
}

func isNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
