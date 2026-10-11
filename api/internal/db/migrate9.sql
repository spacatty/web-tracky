CREATE INDEX IF NOT EXISTS idx_results_run ON check_results (run_id);
CREATE INDEX IF NOT EXISTS idx_results_pending ON check_results (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_jobs_result ON jobs (result_id);
CREATE INDEX IF NOT EXISTS idx_jobs_run ON jobs (run_id);

INSERT INTO schema_migrations (version) VALUES (9);
