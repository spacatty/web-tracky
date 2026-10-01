"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";

import { LatencyChart, UptimeChart } from "@/components/latency-chart";
import { LoadBar } from "@/components/load-bar";
import { StatusPill } from "@/components/status-pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatInterval, formatMs, formatUptime, locationLabel } from "@/lib/format";
import type { MonitorDetail } from "@/lib/types";

export default function PublicStatusPage() {
  const params = useParams<{ slug: string }>();
  const query = useQuery({
    queryKey: ["public", params.slug],
    queryFn: () => api<MonitorDetail>(`/api/public/status/${params.slug}`),
    refetchInterval: 4000,
  });
  const monitor = query.data;
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-10">
      <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Status</p>
      {!monitor ? (
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{query.isError ? "This status page is not available." : "Loading…"}</h1>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">{monitor.name}</h1>
              <p className="mt-1 font-mono text-sm text-muted-foreground">{monitor.target_url}</p>
            </div>
            <StatusPill status={monitor.last_status} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card><CardHeader><CardTitle className="text-xs text-muted-foreground uppercase">24h</CardTitle></CardHeader><CardContent className="font-mono text-2xl">{formatUptime(monitor.uptime_24h)}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-xs text-muted-foreground uppercase">7d</CardTitle></CardHeader><CardContent className="font-mono text-2xl">{formatUptime(monitor.uptime_7d)}</CardContent></Card>
            <Card><CardHeader><CardTitle className="text-xs text-muted-foreground uppercase">Interval</CardTitle></CardHeader><CardContent className="font-mono text-2xl">{formatInterval(monitor.interval_sec)}</CardContent></Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Locations</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(monitor.latest_run?.results ?? []).map((result) => (
                <div key={result.id} className="grid items-center gap-2 sm:grid-cols-[180px_1fr_auto]">
                  <div className="text-sm">{locationLabel(result.city, result.country_code, result.node_name)}</div>
                  {result.status === "pending" ? <LoadBar /> : <StatusPill status={result.status} />}
                  <div className="font-mono text-xs text-muted-foreground">{result.status === "pending" ? "checking" : `${formatMs(result.total_ms)} · ${result.http_status ?? "—"}`}</div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card><CardHeader><CardTitle>Latency</CardTitle></CardHeader><CardContent><LatencyChart points={monitor.points} /></CardContent></Card>
          <Card><CardHeader><CardTitle>Uptime</CardTitle></CardHeader><CardContent><UptimeChart buckets={monitor.buckets} /></CardContent></Card>
        </div>
      )}
    </main>
  );
}
