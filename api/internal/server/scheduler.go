package server

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/jackc/pgx/v5"

	"tracky/api/internal/pack"
)

func (s *Server) RunScheduler() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		s.scheduleOnce()
		s.expireOnce()
	}
}

func (s *Server) RunRetention() {
	s.retain()
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		s.retain()
	}
}

func (s *Server) retain() {
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, `DELETE FROM node_metrics WHERE ts < now() - make_interval(days => $1)`, s.cfg.RetentionDays); err != nil {
		log.Printf("retention metrics: %v", err)
	}
	if _, err := s.pool.Exec(ctx, `DELETE FROM check_runs WHERE started_at < now() - make_interval(days => $1)`, s.cfg.RetentionDays); err != nil {
		log.Printf("retention runs: %v", err)
	}
}

func (s *Server) scheduleOnce() {
	ctx := context.Background()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		log.Printf("schedule: %v", err)
		return
	}
	defer tx.Rollback(ctx)
	var locked bool
	if err := tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(842010)`).Scan(&locked); err != nil {
		log.Printf("schedule lock: %v", err)
		return
	}
	if !locked {
		return
	}
	rows, err := tx.Query(ctx, `
		SELECT id::text FROM monitors
		WHERE enabled AND next_run_at <= now()
		ORDER BY next_run_at
		LIMIT 50
		FOR UPDATE SKIP LOCKED`)
	if err != nil {
		log.Printf("schedule query: %v", err)
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			log.Printf("schedule scan: %v", err)
			return
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("schedule rows: %v", err)
		return
	}
	runs := make([]runView, 0, len(ids))
	for _, id := range ids {
		run, err := s.insertRun(ctx, tx, id, "schedule")
		if err != nil {
			log.Printf("schedule monitor %s: %v", id, err)
			return
		}
		runs = append(runs, run)
	}
	if err := tx.Commit(ctx); err != nil {
		log.Printf("schedule commit: %v", err)
		return
	}
	for _, run := range runs {
		s.publishRun(run)
	}
}

func (s *Server) enqueue(ctx context.Context, monitorID, trigger string) (runView, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return runView{}, err
	}
	defer tx.Rollback(ctx)
	run, err := s.insertRun(ctx, tx, monitorID, trigger)
	if err != nil {
		return runView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return runView{}, err
	}
	s.publishRun(run)
	return run, nil
}

func (s *Server) publishRun(run runView) {
	s.broker.Publish(run.MonitorID, "run", run)
	for _, res := range run.Results {
		if res.NodeID != nil {
			s.waker.Notify(*res.NodeID)
		}
	}
}

func (s *Server) insertRun(ctx context.Context, tx pgx.Tx, monitorID, trigger string) (runView, error) {
	var target string
	var countries []string
	var maxNodes, interval int
	var rulesRaw []byte
	err := tx.QueryRow(ctx, `
		SELECT target_url, country_codes, max_nodes, interval_sec, success_rules
		FROM monitors WHERE id = $1::uuid FOR UPDATE`, monitorID).Scan(&target, &countries, &maxNodes, &interval, &rulesRaw)
	if err != nil {
		return runView{}, err
	}
	if countries == nil {
		countries = []string{}
	}
	var rules []pack.SuccessRule
	if len(rulesRaw) > 0 {
		if err := json.Unmarshal(rulesRaw, &rules); err != nil {
			return runView{}, err
		}
	}
	doc, _, err := s.packs.Load()
	if err != nil {
		return runView{}, err
	}
	program, err := pack.RenderCheck(doc, target, rules)
	if err != nil {
		return runView{}, err
	}
	run := runView{MonitorID: monitorID, Trigger: trigger, Results: []runResult{}}
	err = tx.QueryRow(ctx, `
		INSERT INTO check_runs (monitor_id, trigger)
		VALUES ($1::uuid, $2)
		RETURNING id::text, started_at`, monitorID, trigger).Scan(&run.ID, &run.StartedAt)
	if err != nil {
		return runView{}, err
	}
	rows, err := tx.Query(ctx, `
		SELECT id, name, city, country, country_code FROM (
			SELECT DISTINCT ON (n.id) n.id::text AS id, n.name, n.city, n.country, n.country_code
			FROM nodes n
			JOIN node_groups ng ON ng.node_id = n.id
			JOIN monitor_groups mg ON mg.group_id = ng.group_id AND mg.monitor_id = $1::uuid
			WHERE n.last_seen_at IS NOT NULL
			  AND n.last_seen_at > now() - make_interval(secs => $2)
			  AND (COALESCE(cardinality($3::text[]), 0) = 0 OR n.country_code = ANY($3::text[]))
			ORDER BY n.id
		) picked
		ORDER BY name
		LIMIT $4`, monitorID, doc.HeartbeatSec*3, countries, maxNodes)
	if err != nil {
		return runView{}, err
	}
	type picked struct {
		id, name, city, country, code string
	}
	var nodes []picked
	for rows.Next() {
		var n picked
		if err := rows.Scan(&n.id, &n.name, &n.city, &n.country, &n.code); err != nil {
			rows.Close()
			return runView{}, err
		}
		nodes = append(nodes, n)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return runView{}, err
	}
	for _, n := range nodes {
		var resultID string
		err := tx.QueryRow(ctx, `
			INSERT INTO check_results (run_id, monitor_id, node_id, node_name, city, country, country_code, status)
			VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, 'pending')
			RETURNING id::text`, run.ID, monitorID, n.id, n.name, n.city, n.country, n.code).Scan(&resultID)
		if err != nil {
			return runView{}, err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO jobs (run_id, result_id, node_id, monitor_id, program, status)
			VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::jsonb, 'queued')`,
			run.ID, resultID, n.id, monitorID, string(program)); err != nil {
			return runView{}, err
		}
		nodeID := n.id
		run.Results = append(run.Results, runResult{
			ID: resultID, NodeID: &nodeID, NodeName: n.name, City: n.city, Country: n.country, CountryCode: n.code, Status: "pending",
		})
	}
	if len(run.Results) == 0 {
		if err := tx.QueryRow(ctx, `UPDATE check_runs SET finished_at = now() WHERE id = $1::uuid RETURNING finished_at`, run.ID).Scan(&run.FinishedAt); err != nil {
			return runView{}, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE monitors SET next_run_at = now() + make_interval(secs => $2) WHERE id = $1::uuid`, monitorID, interval); err != nil {
		return runView{}, err
	}
	return run, nil
}

func (s *Server) expireOnce() {
	ctx := context.Background()
	doc, _, err := s.packs.Load()
	if err != nil {
		return
	}
	rows, err := s.pool.Query(ctx, `
		UPDATE check_results
		SET status = 'fail', error = 'timed out waiting for agent', finished_at = now()
		WHERE status = 'pending' AND created_at < now() - make_interval(secs => $1)
		RETURNING id::text, run_id::text, monitor_id::text, node_id::text, node_name, city, country, country_code, finished_at`, doc.JobTimeoutSec)
	if err != nil {
		log.Printf("expire: %v", err)
		return
	}
	defer rows.Close()
	type expired struct {
		result runResult
		runID  string
		monID  string
	}
	var items []expired
	var resultIDs []string
	var runIDs []string
	for rows.Next() {
		var item expired
		var finished time.Time
		if err := rows.Scan(&item.result.ID, &item.runID, &item.monID, &item.result.NodeID, &item.result.NodeName, &item.result.City, &item.result.Country, &item.result.CountryCode, &finished); err != nil {
			log.Printf("expire scan: %v", err)
			return
		}
		item.result.Status = "fail"
		item.result.Error = "timed out waiting for agent"
		item.result.FinishedAt = &finished
		items = append(items, item)
		resultIDs = append(resultIDs, item.result.ID)
		runIDs = append(runIDs, item.runID)
	}
	if err := rows.Err(); err != nil {
		log.Printf("expire rows: %v", err)
		return
	}
	if len(resultIDs) == 0 {
		return
	}
	if _, err := s.pool.Exec(ctx, `UPDATE jobs SET status = 'expired' WHERE result_id::text = ANY($1::text[]) AND status IN ('queued', 'leased')`, resultIDs); err != nil {
		log.Printf("expire jobs: %v", err)
	}
	if _, err := s.pool.Exec(ctx, `
		UPDATE check_runs r SET finished_at = now()
		WHERE r.finished_at IS NULL
		  AND r.id::text = ANY($1::text[])
		  AND NOT EXISTS (
			SELECT 1 FROM check_results cr WHERE cr.run_id = r.id AND cr.status = 'pending'
		  )`, runIDs); err != nil {
		log.Printf("expire runs: %v", err)
	}
	for _, item := range items {
		s.broker.Publish(item.monID, "result", map[string]any{
			"run_id":       item.runID,
			"monitor_id":   item.monID,
			"result":       item.result,
			"run_finished": true,
		})
	}
}
