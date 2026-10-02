ALTER TABLE nodes ADD COLUMN IF NOT EXISTS update_status text NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS update_target text NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS update_error text NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS update_progress integer NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS update_at timestamptz;
INSERT INTO schema_migrations (version) VALUES (5);
