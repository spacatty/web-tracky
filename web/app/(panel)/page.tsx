"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { StatusPill } from "@/components/status-pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatAgo } from "@/lib/format";
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
          <Stat label="Nodes online" value={`${data.nodes_online}`} hint={`${data.nodes_total} enrolled`} />
          <Stat label="Monitors" value={`${data.monitors_total}`} hint={`${data.monitors_ok} currently up`} />
          <Stat label="Failing" value={`${data.monitors_failing}`} hint="latest run has an error" />
          <Stat label="Coverage" value={data.nodes_total ? `${Math.round((data.nodes_online / data.nodes_total) * 100)}%` : "—"} hint="agents seen recently" />
        </div>
      )}
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
