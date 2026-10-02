"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { UptimeChart } from "@/components/latency-chart";
import { StatusPill } from "@/components/status-pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatAgo, formatUptime } from "@/lib/format";
import type { Overview } from "@/lib/types";

export default function OverviewPage() {
  const query = useQuery({
    queryKey: ["overview"],
    queryFn: () => api<Overview>("/api/overview"),
    refetchInterval: 5000,
  });
  const data = query.data;

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Fleet</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Overview</h1>
      </div>
      {!data ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Monitors" value={`${data.monitors_total}`} hint={`${data.monitors_ok} up · ${data.monitors_failing} failing`} />
          <Stat label="Failing" value={`${data.monitors_failing}`} hint="latest run has an error" />
          <Stat label="Nodes online" value={`${data.nodes_online}`} hint={`${data.nodes_total} enrolled`} />
          <Stat label="Coverage" value={data.nodes_total ? `${Math.round((data.nodes_online / data.nodes_total) * 100)}%` : "—"} hint="agents seen recently" />
        </div>
      )}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Monitors</CardTitle>
            <Link href="/monitors" className="text-xs text-muted-foreground hover:text-foreground">
              All monitors
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!data ? <Skeleton className="h-28" /> : null}
          {data && data.monitors_total > 0 ? (
            <HealthBar ok={data.monitors_ok} failing={data.monitors_failing} total={data.monitors_total} />
          ) : null}
          {data && (data.monitors ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No monitors yet. Add a URL to start checking it.</p>
          ) : null}
          {data && (data.monitors ?? []).length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {(data.monitors ?? []).map((monitor) => (
                <Link key={monitor.id} href={`/monitors/${monitor.id}`} className="rounded-lg border px-3 py-2.5 hover:bg-accent">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">{monitor.name}</span>
                    <StatusPill status={monitor.last_status} />
                  </div>
                  <div className="mt-2">
                    {monitor.buckets.length > 0 ? (
                      <UptimeChart buckets={monitor.buckets} className="h-8" />
                    ) : (
                      <p className="text-[11px] text-muted-foreground">No checks in the last 24h.</p>
                    )}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      24h <span className="font-mono text-foreground">{formatUptime(monitor.uptime_24h)}</span>
                    </span>
                    <span className="font-mono">{formatAgo(monitor.last_checked_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : null}
          {data && data.monitors_total > (data.monitors ?? []).length ? (
            <p className="text-xs text-muted-foreground">
              Showing {(data.monitors ?? []).length} of {data.monitors_total}. Failing monitors are listed first.
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Agent versions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data ? <Skeleton className="h-16" /> : null}
          {data ? (
            <>
              <p className="text-sm text-muted-foreground">
                {data.agent_latest
                  ? <>Published release <span className="font-mono text-foreground">{data.agent_latest}</span>. {data.agents_on_latest} current, {data.agents_behind} behind.</>
                  : "No agent release is published yet, so machines cannot auto-update."}
                {data.agents_updating > 0 ? ` ${data.agents_updating} updating.` : ""}
                {data.agents_failed > 0 ? ` ${data.agents_failed} failed.` : ""}
              </p>
              <div className="space-y-2">
                {data.agent_versions.length === 0 ? <p className="text-sm text-muted-foreground">No enrolled machines.</p> : null}
                {data.agent_versions.map((row) => (
                  <div key={row.version} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm">
                    <span className="font-mono">{row.version}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${data.nodes_total ? Math.max(4, Math.round((row.count / data.nodes_total) * 100)) : 0}%` }}
                      />
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{row.online}/{row.count} online</span>
                  </div>
                ))}
              </div>
              {data.updating_agents.length > 0 ? (
                <div className="space-y-2">
                  {data.updating_agents.map((agent) => (
                    <Link key={agent.id} href="/nodes" className="block rounded-lg border px-3 py-2 text-sm hover:bg-accent">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium">{agent.name}</span>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {agent.core_version || "—"} → {agent.update_target || data.agent_latest || "—"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {updateLabel(agent.update_status)}
                        {agent.update_status === "downloading" ? ` ${agent.update_progress}%` : ""}
                        {agent.update_error ? ` · ${agent.update_error}` : ""}
                      </p>
                      {agent.update_status === "downloading" ? (
                        <span className="mt-2 block h-1 overflow-hidden rounded-full bg-muted">
                          <span className="block h-full rounded-full bg-primary" style={{ width: `${agent.update_progress}%` }} />
                        </span>
                      ) : null}
                    </Link>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent failures</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data && data.recent_failures.length === 0 ? <p className="text-sm text-muted-foreground">No failed checks in the retained history.</p> : null}
          {data?.recent_failures.map((failure) => (
            <Link key={`${failure.monitor_id}-${failure.finished_at}-${failure.node_name}`} href={`/monitors/${failure.monitor_id}`} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-accent">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StatusPill status="fail" label="fail" />
                  <span className="truncate font-medium">{failure.monitor_name}</span>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {failure.country_code} {failure.city || failure.node_name} · {failure.error || `HTTP ${failure.http_status ?? "—"}`}
                </p>
              </div>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatAgo(failure.finished_at)}</span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function updateLabel(status: string) {
  switch (status) {
    case "downloading":
      return "Downloading";
    case "verifying":
      return "Verifying checksum";
    case "installing":
      return "Installing";
    case "restarting":
      return "Restarting";
    case "failed":
      return "Update failed";
    case "stalled":
      return "Update stalled";
    default:
      return status || "Updating";
  }
}

function HealthBar({ ok, failing, total }: { ok: number; failing: number; total: number }) {
  const other = Math.max(0, total - ok - failing);
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
      {ok > 0 ? <span className="bg-emerald-500" style={{ width: `${(ok / total) * 100}%` }} /> : null}
      {failing > 0 ? <span className="bg-destructive" style={{ width: `${(failing / total) * 100}%` }} /> : null}
      {other > 0 ? <span className="bg-muted-foreground/40" style={{ width: `${(other / total) * 100}%` }} /> : null}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="font-mono text-3xl tracking-tight">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
