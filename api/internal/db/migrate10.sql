CREATE INDEX IF NOT EXISTS idx_results_monitor_finished ON check_results (monitor_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_results_failed ON check_results (finished_at DESC NULLS LAST) WHERE status = 'fail';

INSERT INTO schema_migrations (version) VALUES (10);
