"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, CheckCircle2Icon, PauseCircleIcon } from "lucide-react";
import Link from "next/link";
import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatAgo, formatMs, formatUptime } from "@/lib/format";
import type { CheckHour, MonitorSnapshot, Overview } from "@/lib/types";

const HOUR = 3_600_000;

export default function OverviewPage() {
  const query = useQuery({
    queryKey: ["overview"],
    queryFn: () => api<Overview>("/api/overview"),
    refetchInterval: 5000,
  });
  const data = query.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Fleet</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Overview</h1>
        </div>
        {data ? <Headline data={data} /> : null}
      </div>
      {!data ? <Loading /> : <Dashboard data={data} />}
    </div>
  );
}

function Loading() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-[32rem]" />
        <Skeleton className="h-[32rem]" />
      </div>
    </div>
  );
}

function Headline({ data }: { data: Overview }) {
  if (data.monitors_total === 0) {
    return <span className="text-sm text-muted-foreground">No monitors yet</span>;
  }
  const failing = data.monitors_failing;
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${
        failing > 0 ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      }`}
    >
      {failing > 0 ? <AlertTriangleIcon className="size-4" /> : <CheckCircle2Icon className="size-4" />}
      {failing > 0 ? `${failing} monitor${failing === 1 ? "" : "s"} failing` : "All monitors passing"}
      <span className="relative flex size-2">
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${failing > 0 ? "bg-destructive" : "bg-emerald-500"}`} />
        <span className={`relative inline-flex size-2 rounded-full ${failing > 0 ? "bg-destructive" : "bg-emerald-500"}`} />
      </span>
    </span>
  );
}

function Dashboard({ data }: { data: Overview }) {
  const hours = fillHours(data.checks.hours);
  const uptime = data.checks.total ? 1 - data.checks.failed / data.checks.total : null;
  const other = Math.max(0, data.monitors_total - data.monitors_ok - data.monitors_failing - data.monitors_paused);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Monitors" value={`${data.monitors_ok}/${data.monitors_total - data.monitors_paused}`} hint="passing on last run">
          <Segments
            parts={[
              { value: data.monitors_ok, className: "bg-emerald-500", label: "passing" },
              { value: data.monitors_failing, className: "bg-destructive", label: "failing" },
              { value: other, className: "bg-amber-400", label: "pending" },
              { value: data.monitors_paused, className: "bg-muted-foreground/40", label: "paused" },
            ]}
          />
        </Kpi>
        <Kpi label="Uptime · 24h" value={formatUptime(uptime)} hint={`${data.checks.failed.toLocaleString()} of ${data.checks.total.toLocaleString()} checks failed`}>
          <Spark values={hours.map((hour) => (hour.ok + hour.fail ? hour.ok / (hour.ok + hour.fail) : null))} min={0} max={1} className="text-emerald-500" />
        </Kpi>
        <Kpi label="Latency · 24h" value={formatMs(data.checks.avg_ms)} hint={`p95 ${formatMs(data.checks.p95_ms)}`}>
          <Spark values={hours.map((hour) => hour.avg_ms)} className="text-sky-500" />
        </Kpi>
        <Kpi label="Nodes online" value={`${data.nodes_online}/${data.nodes_total}`} hint={data.nodes_total ? `${Math.round((data.nodes_online / data.nodes_total) * 100)}% of the fleet reporting` : "no machines enrolled"}>
          <Segments
            parts={[
              { value: data.nodes_online, className: "bg-emerald-500", label: "online" },
              { value: data.nodes_total - data.nodes_online, className: "bg-destructive/70", label: "offline" },
            ]}
          />
        </Kpi>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <ActivityCard hours={hours} />
          <MonitorsCard monitors={data.monitors} total={data.monitors_total} />
          <FleetCard data={data} />
        </div>
        <FailuresCard data={data} />
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, children }: { label: string; value: string; hint: string; children: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardContent className="space-y-2">
        <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
        <div className="font-mono text-2xl tracking-tight tabular-nums">{value}</div>
        <div className="h-7">{children}</div>
        <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function Segments({ parts }: { parts: { value: number; className: string; label: string }[] }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <div className="flex h-full flex-col justify-center gap-1.5">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {total > 0
          ? parts.map((part) =>
              part.value > 0 ? <span key={part.label} className={part.className} style={{ width: `${(part.value / total) * 100}%` }} title={`${part.value} ${part.label}`} /> : null,
            )
          : null}
      </div>
      <div className="flex flex-wrap gap-x-2.5 text-[10px] text-muted-foreground">
        {parts
          .filter((part) => part.value > 0)
          .map((part) => (
            <span key={part.label} className="inline-flex items-center gap-1">
              <span className={`size-1.5 rounded-full ${part.className}`} />
              {part.value} {part.label}
            </span>
          ))}
      </div>
    </div>
  );
}

function Spark({ values, min, max, className }: { values: (number | null)[]; min?: number; max?: number; className?: string }) {
  const known = values.filter((value): value is number => value != null);
  if (known.length < 2) return <div className="flex h-full items-center text-[10px] text-muted-foreground">Not enough data yet</div>;
  const lo = min ?? Math.min(...known);
  const hi = max ?? Math.max(...known);
  const span = hi - lo || 1;
  const width = 100;
  const height = 28;
  const step = width / Math.max(values.length - 1, 1);
  const points: string[] = [];
  values.forEach((value, index) => {
    if (value == null) return;
    points.push(`${(index * step).toFixed(2)},${(height - 2 - ((value - lo) / span) * (height - 4)).toFixed(2)}`);
  });
  const first = points[0]?.split(",")[0] ?? "0";
  const last = points[points.length - 1]?.split(",")[0] ?? `${width}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={`h-full w-full overflow-visible ${className ?? ""}`}>
      <polygon points={`${first},${height} ${points.join(" ")} ${last},${height}`} fill="currentColor" opacity={0.12} />
      <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const OK_COLOR = "oklch(0.7 0.15 160)";
const LATENCY_COLOR = "oklch(0.68 0.13 245)";

const activityConfig = {
  ok: { label: "Passed", color: OK_COLOR },
  fail: { label: "Failed", color: "var(--destructive)" },
  avg_ms: { label: "Avg latency", color: LATENCY_COLOR },
} satisfies ChartConfig;

function ActivityCard({ hours }: { hours: CheckHour[] }) {
  const empty = hours.every((hour) => hour.ok + hour.fail === 0);
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle>Checks · last 24 hours</CardTitle>
          <div className="flex gap-3 text-[11px] text-muted-foreground">
            <Legend color={OK_COLOR} label="passed" />
            <Legend color="var(--destructive)" label="failed" />
            <Legend color={LATENCY_COLOR} label="avg latency" line />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Check activity appears here once monitors start running.</p>
        ) : (
          <ChartContainer config={activityConfig} className="aspect-auto h-56 w-full">
            <ComposedChart data={hours} margin={{ left: 0, right: 0, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="t"
                tickLine={false}
                axisLine={false}
                minTickGap={24}
                tickFormatter={(value) => new Date(String(value)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              />
              <YAxis yAxisId="count" tickLine={false} axisLine={false} width={32} allowDecimals={false} />
              <YAxis yAxisId="ms" orientation="right" tickLine={false} axisLine={false} width={44} tickFormatter={(value) => `${Math.round(Number(value))}ms`} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => {
                      const row = payload?.[0]?.payload as CheckHour | undefined;
                      return row ? new Date(row.t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
                    }}
                    formatter={(value, name) => [name === "avg_ms" ? formatMs(Number(value)) : Number(value).toLocaleString(), activityConfig[name as keyof typeof activityConfig]?.label ?? name]}
                  />
                }
              />
              <Bar yAxisId="count" dataKey="ok" stackId="checks" fill="var(--color-ok)" radius={[0, 0, 2, 2]} />
              <Bar yAxisId="count" dataKey="fail" stackId="checks" fill="var(--color-fail)" radius={[2, 2, 0, 0]} />
              <Line yAxisId="ms" dataKey="avg_ms" type="monotone" stroke="var(--color-avg_ms)" strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={line ? "h-0.5 w-3 rounded-full" : "size-2 rounded-sm"} style={{ background: color }} />
      {label}
    </span>
  );
}

function MonitorsCard({ monitors, total }: { monitors: MonitorSnapshot[]; total: number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Monitors</CardTitle>
          <Link href="/monitors" className="text-xs text-muted-foreground hover:text-foreground">
            Manage all {total}
          </Link>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {monitors.length === 0 ? <p className="px-4 text-sm text-muted-foreground">No monitors yet. Add a URL to start checking it.</p> : null}
        {monitors.length > 0 ? (
          <div className="hidden grid-cols-[minmax(0,1fr)_6rem_9rem_4.5rem_4rem] gap-3 border-b px-4 pb-2 text-[10px] tracking-wide text-muted-foreground uppercase md:grid">
            <span>Monitor</span>
            <span>Latency 24h</span>
            <span>Hourly uptime</span>
            <span className="text-right">Uptime</span>
            <span className="text-right">Avg</span>
          </div>
        ) : null}
        <div className="divide-y">
          {monitors.map((monitor) => (
            <MonitorRow key={monitor.id} monitor={monitor} />
          ))}
        </div>
        {total > monitors.length ? (
          <p className="px-4 pt-2 text-[11px] text-muted-foreground">
            Showing {monitors.length} of {total}. Failing monitors come first.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MonitorRow({ monitor }: { monitor: MonitorSnapshot }) {
  const hours = lastHours();
  const byHour = new Map(monitor.buckets.map((bucket) => [floorHour(bucket.t), bucket]));
  const latency = hours.map((hour) => byHour.get(hour)?.avg_ms ?? null);
  const failing = monitor.enabled && monitor.last_status === "fail";
  return (
    <Link
      href={`/monitors/${monitor.id}`}
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 transition-colors hover:bg-accent md:grid-cols-[minmax(0,1fr)_6rem_9rem_4.5rem_4rem] ${failing ? "bg-destructive/5" : ""} ${monitor.enabled ? "" : "opacity-60"}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusDot status={monitor.enabled ? monitor.last_status : "paused"} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{monitor.name}</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {hostOf(monitor.target_url)} · {monitor.enabled ? formatAgo(monitor.last_checked_at) : "paused"}
          </div>
        </div>
      </div>
      <div className="hidden h-7 md:block">
        <Spark values={latency} className="text-sky-500" />
      </div>
      <div className="hidden md:block">
        <HourStrip hours={hours} byHour={byHour} />
      </div>
      <div className={`text-right font-mono text-xs tabular-nums ${uptimeTone(monitor.uptime_24h)}`}>{formatUptime(monitor.uptime_24h)}</div>
      <div className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums md:block">{formatMs(monitor.avg_ms_24h)}</div>
    </Link>
  );
}

function HourStrip({ hours, byHour }: { hours: number[]; byHour: Map<number, { ok_ratio: number }> }) {
  return (
    <div className="flex h-5 items-stretch gap-px">
      {hours.map((hour) => {
        const bucket = byHour.get(hour);
        const ratio = bucket?.ok_ratio;
        const tone = ratio == null ? "bg-muted" : ratio >= 0.999 ? "bg-emerald-500" : ratio >= 0.9 ? "bg-amber-400" : "bg-destructive";
        const label = new Date(hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return <span key={hour} className={`flex-1 rounded-[2px] ${tone}`} title={ratio == null ? `${label} · no checks` : `${label} · ${(ratio * 100).toFixed(1)}% up`} />;
      })}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  if (status === "paused") return <PauseCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />;
  const tone = status === "ok" ? "bg-emerald-500" : status === "fail" ? "bg-destructive" : status === "pending" ? "bg-amber-400 animate-pulse" : "bg-muted-foreground/40";
  return (
    <span className="relative flex size-2.5 shrink-0">
      {status === "fail" ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-50" /> : null}
      <span className={`relative inline-flex size-2.5 rounded-full ${tone}`} />
    </span>
  );
}

function FleetCard({ data }: { data: Overview }) {
  const offline = data.nodes_total - data.nodes_online;
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Fleet</CardTitle>
          <Link href="/nodes" className="text-xs text-muted-foreground hover:text-foreground">
            All nodes
          </Link>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex items-center gap-4">
          <Ring value={data.nodes_total ? data.nodes_online / data.nodes_total : 0} label={`${data.nodes_online}`} sub="online" />
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500" />
              {data.nodes_online} online
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-full bg-destructive/70" />
              {offline} offline
            </div>
            <div className="text-muted-foreground">{data.nodes_total} enrolled</div>
          </div>
        </div>
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <span className="font-medium">Agent versions</span>
            <span className="text-muted-foreground">
              {data.agent_latest ? (
                <>
                  latest <span className="font-mono text-foreground">{data.agent_latest}</span> · {data.agents_on_latest} current · {data.agents_behind} behind
                </>
              ) : (
                "no release published"
              )}
            </span>
          </div>
          {data.agent_versions.length === 0 ? <p className="text-xs text-muted-foreground">No enrolled machines.</p> : null}
          {data.agent_versions.map((row) => (
            <div key={row.version} className="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-xs">
              <span className="truncate font-mono">
                {row.version}
                {row.version === data.agent_latest ? <span className="ml-1 text-emerald-600 dark:text-emerald-400">✓</span> : null}
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                <span
                  className={`block h-full rounded-full ${row.version === data.agent_latest ? "bg-emerald-500" : "bg-primary/60"}`}
                  style={{ width: `${data.nodes_total ? Math.max(4, Math.round((row.count / data.nodes_total) * 100)) : 0}%` }}
                />
              </span>
              <span className="text-right font-mono text-muted-foreground">
                {row.online}/{row.count}
              </span>
            </div>
          ))}
          {data.updating_agents.length > 0 ? (
            <div className="space-y-1.5 pt-1">
              {data.updating_agents.map((agent) => (
                <Link key={agent.id} href="/nodes" className="block rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{agent.name}</span>
                    <span className={`shrink-0 font-mono ${agent.update_status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                      {updateLabel(agent.update_status)}
                      {agent.update_status === "downloading" ? ` ${agent.update_progress}%` : ""} · {agent.core_version || "—"} → {agent.update_target || data.agent_latest || "—"}
                    </span>
                  </div>
                  {agent.update_status === "downloading" ? (
                    <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${agent.update_progress}%` }} />
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Ring({ value, label, sub }: { value: number; label: string; sub: string }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative size-16 shrink-0">
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="6" className="stroke-muted" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          className="stroke-emerald-500 transition-[stroke-dashoffset] duration-500"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(Math.max(value, 0), 1))}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-mono text-sm font-medium">{label}</span>
        <span className="text-[9px] text-muted-foreground">{sub}</span>
      </div>
    </div>
  );
}

function FailuresCard({ data }: { data: Overview }) {
  const spots = data.checks.fail_spots;
  const top = Math.max(1, ...spots.map((spot) => spot.count));
  return (
    <Card size="sm" className="flex flex-col lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)]">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Recent failures</CardTitle>
          <Badge variant={data.checks.failed > 0 ? "destructive" : "secondary"}>{data.checks.failed.toLocaleString()} in 24h</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        {spots.length > 0 ? (
          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-2.5">
            <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Where checks fail</div>
            {spots.map((spot) => (
              <div key={`${spot.country_code}-${spot.city}`} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs">
                <span className="truncate">{[spot.country_code, spot.city].filter(Boolean).join(" ") || "Unknown"}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-destructive/80" style={{ width: `${(spot.count / top) * 100}%` }} />
                </span>
                <span className="text-right font-mono text-muted-foreground">{spot.count}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="-mx-4 max-h-[28rem] min-h-0 flex-1 overflow-y-auto px-4 lg:max-h-none">
          {data.recent_failures.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <CheckCircle2Icon className="size-6 text-emerald-500" />
              No failed checks in the retained history.
            </div>
          ) : null}
          <ol className="relative space-y-1 border-l border-border/70 pl-3">
            {data.recent_failures.map((failure, index) => (
              <li key={`${failure.monitor_id}-${failure.finished_at}-${failure.node_name}-${index}`} className="relative">
                <span className="absolute top-3 -left-[17px] size-2 rounded-full bg-destructive ring-2 ring-card" />
                <Link href={`/monitors/${failure.monitor_id}`} className="block rounded-md px-2 py-1.5 hover:bg-accent">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{failure.monitor_name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{formatAgo(failure.finished_at)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {failure.http_status ? (
                      <span className="rounded bg-destructive/10 px-1 font-mono text-destructive">{failure.http_status}</span>
                    ) : null}
                    <span className="truncate">{[failure.country_code, failure.city || failure.node_name].filter(Boolean).join(" ")}</span>
                  </div>
                  {failure.error ? <p className="mt-0.5 line-clamp-2 text-[11px] break-words text-muted-foreground/80">{failure.error}</p> : null}
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}

function floorHour(iso: string | number) {
  const time = typeof iso === "number" ? iso : new Date(iso).getTime();
  return Math.floor(time / HOUR) * HOUR;
}

function lastHours() {
  const now = floorHour(Date.now());
  return Array.from({ length: 24 }, (_, index) => now - (23 - index) * HOUR);
}

function fillHours(hours: CheckHour[]): CheckHour[] {
  const byHour = new Map(hours.map((hour) => [floorHour(hour.t), hour]));
  return lastHours().map((hour) => byHour.get(hour) ?? { t: new Date(hour).toISOString(), ok: 0, fail: 0, avg_ms: null });
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function uptimeTone(value: number | null) {
  if (value == null) return "text-muted-foreground";
  if (value >= 0.999) return "text-emerald-600 dark:text-emerald-400";
  if (value >= 0.95) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

function updateLabel(status: string) {
  switch (status) {
    case "downloading":
      return "Downloading";
    case "verifying":
      return "Verifying";
    case "installing":
      return "Installing";
    case "restarting":
      return "Restarting";
    case "failed":
      return "Failed";
    case "stalled":
      return "Stalled";
    default:
      return status || "Updating";
  }
}
