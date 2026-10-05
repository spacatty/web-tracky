"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2Icon, CircleAlertIcon, CirclePauseIcon, LockIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { cn } from "cn";

import { FolderGlyph } from "@/components/folder-ui";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatAgo, formatMs, formatUptime } from "@/lib/format";
import type { PublicGroup, PublicGroupMonitor } from "@/lib/types";

const storageKey = (slug: string) => `tracky-group-token:${slug}`;
const terminal = (error: unknown) => error instanceof ApiError && (error.status === 401 || error.status === 404);
const ranges = [
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
];

export default function PublicGroupStatusPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [hours, setHours] = useState(24);
  const [token, setToken] = useState<string | null>(() => (typeof window === "undefined" ? null : window.sessionStorage.getItem(storageKey(slug))));
  const headers = useMemo(() => (token ? { "X-Status-Token": token } : undefined), [token]);
  const query = useQuery({
    queryKey: ["public-group", slug, token, hours],
    queryFn: () => api<PublicGroup>(`/api/public/group-status/${slug}?hours=${hours}`, { headers }),
    refetchInterval: (state) => (terminal(state.state.error) ? false : 15000),
    retry: (count, error) => !terminal(error) && count < 2,
    placeholderData: (previous) => previous,
  });
  const locked = query.error instanceof ApiError && query.error.status === 401;
  const group = query.data;

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-10">
      {locked ? (
        <Unlock
          slug={slug}
          onUnlocked={(next) => {
            window.sessionStorage.setItem(storageKey(slug), next);
            setToken(next);
          }}
        />
      ) : !group ? (
        query.isError ? (
          <div className="py-24 text-center">
            <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Status</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">This status page is not available.</h1>
          </div>
        ) : (
          <div className="space-y-4">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        )
      ) : (
        <div className="space-y-6">
          <header className="flex items-start gap-4">
            <FolderGlyph color={group.color} icon={group.icon} size="lg" />
            <div className="min-w-0">
              <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Status</p>
              <h1 className="text-2xl font-semibold tracking-tight">{group.name}</h1>
              {group.description ? <p className="mt-1 text-sm text-muted-foreground">{group.description}</p> : null}
            </div>
          </header>
          <Overall group={group} updatedAt={query.dataUpdatedAt} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium">
              {group.monitors.length} service{group.monitors.length === 1 ? "" : "s"}
            </h2>
            <div className="flex rounded-lg bg-muted p-[3px] text-xs">
              {ranges.map((range) => (
                <button
                  key={range.hours}
                  type="button"
                  onClick={() => setHours(range.hours)}
                  className={cn(
                    "rounded-md px-2.5 py-1 transition-colors",
                    hours === range.hours ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
          <div className={cn("divide-y overflow-hidden rounded-xl border bg-card transition-opacity", query.isPlaceholderData && "opacity-60")}>
            {group.monitors.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted-foreground">No services in this group yet.</p> : null}
            {group.monitors.map((monitor) => (
              <MonitorStrip key={monitor.id} monitor={monitor} group={group} />
            ))}
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            Uptime over the last {ranges.find((range) => range.hours === hours)?.label ?? `${hours} hours`}
            {group.uptime != null ? `: ${formatUptime(group.uptime)} overall` : ""} · refreshes automatically
          </p>
        </div>
      )}
    </main>
  );
}

function Overall({ group, updatedAt }: { group: PublicGroup; updatedAt: number }) {
  const active = group.monitors.filter((monitor) => monitor.enabled);
  const failing = active.filter((monitor) => monitor.last_status === "fail").length;
  const known = active.filter((monitor) => monitor.last_status === "ok" || monitor.last_status === "fail").length;
  let tone = "border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-400";
  let Icon = CheckCircle2Icon;
  let title = "All systems operational";
  if (active.length === 0) {
    tone = "border-border bg-muted/50 text-muted-foreground";
    Icon = CirclePauseIcon;
    title = "Monitoring is paused";
  } else if (known === 0) {
    tone = "border-border bg-muted/50 text-muted-foreground";
    Icon = CirclePauseIcon;
    title = "Waiting for the first checks";
  } else if (failing > 0 && failing === active.length) {
    tone = "border-destructive/30 bg-destructive/8 text-destructive";
    Icon = CircleAlertIcon;
    title = "Major outage";
  } else if (failing > 0) {
    tone = "border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-400";
    Icon = TriangleAlertIcon;
    title = `Partial outage · ${failing} of ${active.length} affected`;
  }
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border px-4 py-4", tone)}>
      <Icon className="size-6 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="text-xs opacity-80">Updated {formatAgo(new Date(updatedAt).toISOString())}</p>
      </div>
      {group.uptime != null ? (
        <div className="text-right">
          <p className="font-mono text-lg font-semibold">{formatUptime(group.uptime)}</p>
          <p className="text-[11px] opacity-80">uptime</p>
        </div>
      ) : null}
    </div>
  );
}

function barTone(ratio: number | null) {
  if (ratio == null) return "bg-muted-foreground/15";
  if (ratio >= 0.999) return "bg-emerald-500";
  if (ratio >= 0.95) return "bg-amber-400";
  return "bg-destructive";
}

function MonitorStrip({ monitor, group }: { monitor: PublicGroupMonitor; group: PublicGroup }) {
  const slots = useMemo(() => {
    const bin = group.bin_sec * 1000;
    const start = Math.floor(new Date(group.from).getTime() / bin) * bin;
    const end = new Date(group.to).getTime();
    const count = Math.max(1, Math.min(120, Math.ceil((end - start) / bin)));
    const map = new Map(monitor.buckets.map((bucket) => [new Date(bucket.t).getTime(), bucket]));
    return Array.from({ length: count }, (_, i) => {
      const t = start + i * bin;
      const bucket = map.get(t);
      return { t, ratio: bucket ? bucket.ok_ratio : null, avg: bucket?.avg_ms ?? null };
    });
  }, [monitor.buckets, group.bin_sec, group.from, group.to]);

  const name = monitor.public_slug ? (
    <Link href={`/status/${monitor.public_slug}`} className="truncate font-medium hover:underline">
      {monitor.name}
    </Link>
  ) : (
    <span className="truncate font-medium">{monitor.name}</span>
  );

  return (
    <div className="space-y-2.5 px-4 py-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {name}
            {monitor.enabled ? <StatusPill status={monitor.last_status} /> : <StatusPill status="unknown" label="paused" />}
          </div>
        </div>
        <div className="flex shrink-0 items-baseline gap-3 text-xs text-muted-foreground">
          <span className="hidden sm:inline">{formatMs(monitor.avg_ms)}</span>
          <span className="font-mono font-medium text-foreground">{formatUptime(monitor.uptime)}</span>
        </div>
      </div>
      <div className="flex h-8 items-stretch gap-[2px]">
        {slots.map((slot) => (
          <span
            key={slot.t}
            title={`${new Date(slot.t).toLocaleString()} · ${slot.ratio == null ? "no data" : `${(slot.ratio * 100).toFixed(1)}% up${slot.avg != null ? ` · ${formatMs(slot.avg)}` : ""}`}`}
            className={cn("min-w-[2px] flex-1 rounded-[2px] transition-opacity hover:opacity-70", barTone(slot.ratio))}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{new Date(group.from).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        <span>now</span>
      </div>
    </div>
  );
}

function Unlock({ slug, onUnlocked }: { slug: string; onUnlocked: (token: string) => void }) {
  const [password, setPassword] = useState("");
  const unlock = useMutation({
    mutationFn: () => api<{ token: string }>(`/api/public/group-status/${slug}/unlock`, { method: "POST", body: JSON.stringify({ password }) }),
    onSuccess: (result) => onUnlocked(result.token),
  });
  return (
    <Card className="mx-auto mt-16 max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LockIcon className="size-4" />
          Password required
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            unlock.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">This status page is protected. Enter the password you were given.</p>
          <Input type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" required />
          {unlock.isError ? <p className="text-xs text-destructive">{errorMessage(unlock.error, "Could not unlock")}</p> : null}
          <Button type="submit" className="w-full" disabled={unlock.isPending || !password}>
            View status
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
