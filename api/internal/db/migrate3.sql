ALTER TABLE monitors ADD COLUMN IF NOT EXISTS success_rules jsonb NOT NULL DEFAULT '[]'::jsonb;
INSERT INTO schema_migrations (version) VALUES (3);
