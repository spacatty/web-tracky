CREATE TABLE monitor_folders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    color text NOT NULL DEFAULT 'slate',
    icon text NOT NULL DEFAULT 'folder',
    position integer NOT NULL DEFAULT 0,
    public_enabled boolean NOT NULL DEFAULT false,
    public_slug text UNIQUE,
    public_password_hash text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX monitor_folders_owner_name ON monitor_folders (owner_id, lower(name));

ALTER TABLE monitors ADD COLUMN folder_id uuid REFERENCES monitor_folders (id) ON DELETE SET NULL;

CREATE INDEX idx_monitors_folder ON monitors (folder_id) WHERE folder_id IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES (8);
