ALTER TABLE monitors ADD COLUMN IF NOT EXISTS public_password_hash text NOT NULL DEFAULT '';
ALTER TABLE enroll_tokens ADD COLUMN IF NOT EXISTS token_plain text NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS removing_at timestamptz;
INSERT INTO schema_migrations (version) VALUES (6);
