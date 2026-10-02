ALTER TABLE nodes ADD COLUMN IF NOT EXISTS down_bps double precision NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS up_bps double precision NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS speed_at timestamptz;
ALTER TABLE node_metrics ADD COLUMN IF NOT EXISTS down_bps double precision;
ALTER TABLE node_metrics ADD COLUMN IF NOT EXISTS up_bps double precision;
INSERT INTO schema_migrations (version) VALUES (2);
