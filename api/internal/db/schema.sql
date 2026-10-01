CREATE TABLE schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'user')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    visibility text NOT NULL CHECK (visibility IN ('public', 'private')),
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_users (
    group_id uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, user_id)
);

CREATE TABLE nodes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    name_locked boolean NOT NULL DEFAULT false,
    token_hash text NOT NULL UNIQUE,
    last_seen_at timestamptz,
    core_version text NOT NULL DEFAULT '',
    pack_version integer NOT NULL DEFAULT 0,
    ip text NOT NULL DEFAULT '',
    country text NOT NULL DEFAULT '',
    country_code text NOT NULL DEFAULT '',
    city text NOT NULL DEFAULT '',
    latitude double precision,
    longitude double precision,
    location_locked boolean NOT NULL DEFAULT false,
    adapter text NOT NULL DEFAULT '',
    link_speed_bps bigint NOT NULL DEFAULT 0,
    rx_bps double precision NOT NULL DEFAULT 0,
    tx_bps double precision NOT NULL DEFAULT 0,
    api_rtt_ms double precision,
    hostname text NOT NULL DEFAULT '',
    os text NOT NULL DEFAULT '',
    arch text NOT NULL DEFAULT '',
    kernel text NOT NULL DEFAULT '',
    last_sample jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE node_groups (
    node_id uuid NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    group_id uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    PRIMARY KEY (node_id, group_id)
);

CREATE TABLE enroll_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL DEFAULT '',
    token_hash text NOT NULL UNIQUE,
    created_by uuid REFERENCES users (id) ON DELETE SET NULL,
    expires_at timestamptz,
    max_uses integer NOT NULL DEFAULT 1,
    uses integer NOT NULL DEFAULT 0,
    revoked boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enroll_token_groups (
    token_id uuid NOT NULL REFERENCES enroll_tokens (id) ON DELETE CASCADE,
    group_id uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    PRIMARY KEY (token_id, group_id)
);

CREATE TABLE monitors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name text NOT NULL,
    target_url text NOT NULL,
    interval_sec integer NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    public_enabled boolean NOT NULL DEFAULT false,
    public_slug text UNIQUE,
    country_codes text[] NOT NULL DEFAULT '{}',
    max_nodes integer NOT NULL DEFAULT 20,
    next_run_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE monitor_groups (
    monitor_id uuid NOT NULL REFERENCES monitors (id) ON DELETE CASCADE,
    group_id uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    PRIMARY KEY (monitor_id, group_id)
);

CREATE TABLE check_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    monitor_id uuid NOT NULL REFERENCES monitors (id) ON DELETE CASCADE,
    trigger text NOT NULL CHECK (trigger IN ('schedule', 'manual')),
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);

CREATE TABLE check_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES check_runs (id) ON DELETE CASCADE,
    monitor_id uuid NOT NULL REFERENCES monitors (id) ON DELETE CASCADE,
    node_id uuid REFERENCES nodes (id) ON DELETE SET NULL,
    node_name text NOT NULL DEFAULT '',
    city text NOT NULL DEFAULT '',
    country text NOT NULL DEFAULT '',
    country_code text NOT NULL DEFAULT '',
    status text NOT NULL CHECK (status IN ('pending', 'ok', 'fail')),
    http_status integer,
    ttfb_ms double precision,
    total_ms double precision,
    ping_ms double precision,
    error text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);

CREATE TABLE jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES check_runs (id) ON DELETE CASCADE,
    result_id uuid NOT NULL REFERENCES check_results (id) ON DELETE CASCADE,
    node_id uuid NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    monitor_id uuid NOT NULL REFERENCES monitors (id) ON DELETE CASCADE,
    program jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('queued', 'leased', 'done', 'expired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    leased_at timestamptz
);

CREATE TABLE node_metrics (
    id bigserial PRIMARY KEY,
    node_id uuid NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    ts timestamptz NOT NULL DEFAULT now(),
    rx_bps double precision NOT NULL DEFAULT 0,
    tx_bps double precision NOT NULL DEFAULT 0,
    link_speed_bps bigint NOT NULL DEFAULT 0,
    api_rtt_ms double precision
);

CREATE TABLE instruction_packs (
    version integer PRIMARY KEY,
    core_min text NOT NULL,
    document jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_nodes_last_seen ON nodes (last_seen_at);
CREATE INDEX idx_monitors_due ON monitors (next_run_at) WHERE enabled;
CREATE INDEX idx_jobs_node_status ON jobs (node_id, status);
CREATE INDEX idx_results_monitor_time ON check_results (monitor_id, created_at DESC);
CREATE INDEX idx_metrics_node_ts ON node_metrics (node_id, ts DESC);
CREATE INDEX idx_runs_monitor ON check_runs (monitor_id, started_at DESC);

INSERT INTO schema_migrations (version) VALUES (1);
