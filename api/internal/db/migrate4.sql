ALTER TABLE nodes ADD COLUMN IF NOT EXISTS metrics_refresh boolean NOT NULL DEFAULT false;
INSERT INTO schema_migrations (version) VALUES (4);
