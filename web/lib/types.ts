export type Role = "admin" | "user";

export type GroupRef = {
  id: string;
  name: string;
  visibility: "public" | "private";
};

export type Me = {
  id: string;
  email: string;
  role: Role;
  groups: GroupRef[];
};

export type PublicConfig = {
  registration: "open" | "closed";
  app_url: string;
  agent_url: string;
  min_interval_sec: number;
};

export type Group = {
  id: string;
  name: string;
  slug: string;
  visibility: "public" | "private";
  description: string;
  user_count: number;
  node_count: number;
  created_at: string;
  users?: { id: string; name: string }[];
  nodes?: { id: string; name: string; online?: boolean }[];
};

export type FleetNode = {
  id: string;
  name: string;
  online: boolean;
  last_seen_at: string | null;
  core_version: string;
  pack_version: number;
  ip?: string;
  country: string;
  country_code: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  adapter: string;
  link_speed_bps: number;
  rx_bps: number;
  tx_bps: number;
  down_bps: number;
  up_bps: number;
  speed_at: string | null;
  api_rtt_ms: number | null;
  hostname: string;
  os: string;
  arch: string;
  kernel: string;
  last_sample?: Record<string, unknown>;
  update_status: string;
  update_target: string;
  update_error: string;
  update_progress: number;
  update_at: string | null;
  core_latest: string;
  removing: boolean;
  groups: GroupRef[];
  created_at: string;
};

export type MetricPoint = {
  t: string;
  down_bps: number;
  up_bps: number;
  rx_bps: number;
  tx_bps: number;
  api_rtt_ms: number | null;
};

export type UserRow = {
  id: string;
  email: string;
  role: Role;
  groups: GroupRef[];
  created_at: string;
};

export type EnrollToken = {
  id: string;
  name: string;
  token?: string;
  expires_at: string | null;
  max_uses: number;
  uses: number;
  revoked: boolean;
  groups: GroupRef[];
  created_at: string;
};

export type SuccessRule = {
  status: number;
  body: "any" | "empty" | "contains";
  text?: string;
  join?: "and" | "or";
};

export type Monitor = {
  id: string;
  name: string;
  target_url: string;
  interval_sec: number;
  enabled: boolean;
  public_enabled: boolean;
  public_slug: string | null;
  public_protected: boolean;
  country_codes: string[];
  max_nodes: number;
  success_rules?: SuccessRule[];
  template_id: string | null;
  template_name: string;
  groups: GroupRef[];
  last_status: string;
  last_checked_at: string | null;
  uptime_24h: number | null;
  owner_email?: string;
  created_at: string;
};

export type CheckResult = {
  id: string;
  node_id: string | null;
  node_name: string;
  city: string;
  country: string;
  country_code: string;
  status: "pending" | "ok" | "fail";
  http_status: number | null;
  ttfb_ms: number | null;
  total_ms: number | null;
  ping_ms: number | null;
  error: string;
  finished_at: string | null;
};

export type CheckRun = {
  id: string;
  monitor_id: string;
  trigger: "schedule" | "manual";
  started_at: string;
  finished_at: string | null;
  results: CheckResult[];
};

export type LatencyPoint = {
  t: string;
  node_id: string;
  label: string;
  total_ms: number;
  ok: boolean;
};

export type UptimeBucket = {
  t: string;
  ok_ratio: number;
};

export type MonitorDetail = Monitor & {
  latest_run: CheckRun | null;
  uptime_7d: number | null;
  points: LatencyPoint[];
  buckets: UptimeBucket[];
};

export type MonitorSeries = {
  points: LatencyPoint[];
  buckets: UptimeBucket[];
};

export type MonitorSnapshot = {
  id: string;
  name: string;
  target_url: string;
  enabled: boolean;
  last_status: string;
  last_checked_at: string | null;
  uptime_24h: number | null;
  avg_ms_24h: number | null;
  buckets: (UptimeBucket & { avg_ms: number | null })[];
};

export type CheckHour = {
  t: string;
  ok: number;
  fail: number;
  avg_ms: number | null;
};

export type CheckSummary = {
  total: number;
  failed: number;
  avg_ms: number | null;
  p95_ms: number | null;
  hours: CheckHour[];
  fail_spots: { country_code: string; city: string; count: number }[];
};

export type AgentVersionCount = {
  version: string;
  count: number;
  online: number;
};

export type UpdatingAgent = {
  id: string;
  name: string;
  core_version: string;
  update_status: string;
  update_target: string;
  update_progress: number;
  update_error: string;
};

export type Overview = {
  nodes_online: number;
  nodes_total: number;
  monitors_total: number;
  monitors_failing: number;
  monitors_ok: number;
  monitors_paused: number;
  checks: CheckSummary;
  agent_latest: string;
  agent_versions: AgentVersionCount[];
  agents_on_latest: number;
  agents_behind: number;
  agents_updating: number;
  agents_failed: number;
  updating_agents: UpdatingAgent[];
  monitors: MonitorSnapshot[];
  recent_failures: {
    finished_at: string | null;
    monitor_id: string;
    monitor_name: string;
    node_name: string;
    city: string;
    country_code: string;
    http_status: number | null;
    error: string;
  }[];
};

export type StatusTemplate = {
  id: string;
  name: string;
  success_rules: SuccessRule[];
  created_at: string;
};

export type SpotTarget = {
  url: string;
  name: string;
  status: string;
  run: CheckRun | null;
};

export type SpotCheck = {
  id: string;
  template_name: string;
  created_at: string;
  groups: GroupRef[];
  targets: SpotTarget[];
  pending: number;
  ok: number;
  fail: number;
};

export type SpotSummary = {
  id: string;
  template_name: string;
  created_at: string;
  url_count: number;
  pending: number;
  ok: number;
  fail: number;
};

export type ResultEvent = {
  run_id: string;
  monitor_id: string;
  result: CheckResult;
  run_finished: boolean;
};
