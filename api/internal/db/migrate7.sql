CREATE TABLE status_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    success_rules jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX status_templates_name_lower ON status_templates (lower(name));

CREATE TABLE spot_checks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    template_name text NOT NULL DEFAULT '',
    success_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_spot_checks_owner ON spot_checks (owner_id, created_at DESC);

ALTER TABLE monitors ADD COLUMN template_id uuid REFERENCES status_templates (id) ON DELETE SET NULL;
ALTER TABLE monitors ADD COLUMN kind text NOT NULL DEFAULT 'monitor';
ALTER TABLE monitors ADD CONSTRAINT monitors_kind_check CHECK (kind IN ('monitor', 'spot'));
ALTER TABLE monitors ADD COLUMN spot_id uuid REFERENCES spot_checks (id) ON DELETE CASCADE;
ALTER TABLE monitors ADD COLUMN spot_pos integer NOT NULL DEFAULT 0;

CREATE INDEX idx_monitors_spot ON monitors (spot_id) WHERE spot_id IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES (7);
