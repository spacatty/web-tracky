"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { LatencyChart, UptimeChart } from "@/components/latency-chart";
import { LoadBar } from "@/components/load-bar";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import { formatInterval, formatMs, formatUptime, locationLabel } from "@/lib/format";
import type { CheckRun, MonitorDetail, ResultEvent } from "@/lib/types";

export default function MonitorDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["monitor", id], queryFn: () => api<MonitorDetail>(`/api/monitors/${id}`) });
  const [run, setRun] = useState<CheckRun | null>(null);

  useEffect(() => {
    if (!query.data?.latest_run) return;
    setRun((current) => (current && current.id === query.data.latest_run?.id ? current : query.data.latest_run));
  }, [query.data]);

  useEffect(() => {
    const source = new EventSource(`/api/stream?monitor_id=${id}`);
    const onRun = (event: MessageEvent) => setRun(JSON.parse(event.data) as CheckRun);
    const onResult = (event: MessageEvent) => {
      const payload = JSON.parse(event.data) as ResultEvent;
      setRun((current) => {
        if (!current || current.id !== payload.run_id) return current;
        const results = current.results.map((result) => (result.id === payload.result.id ? payload.result : result));
        return { ...current, results, finished_at: payload.run_finished ? payload.result.finished_at : current.finished_at };
      });
      if (payload.run_finished) client.invalidateQueries({ queryKey: ["monitor", id] });
    };
    source.addEventListener("run", onRun);
    source.addEventListener("result", onResult);
    return () => source.close();
  }, [id, client]);

  const check = useMutation({
    mutationFn: () => api<CheckRun>(`/api/monitors/${id}/check`, { method: "POST" }),
    onSuccess: (next) => {
      setRun(next);
      if (next.results.length === 0) toast.message("No online agents in this pool");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Check failed"),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/monitors/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      window.location.href = "/monitors";
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not delete"),
  });

  if (!query.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  const monitor = query.data;
  const appUrl = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Monitor</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{monitor.name}</h1>
          <a href={monitor.target_url} className="font-mono text-sm text-muted-foreground hover:text-foreground">{monitor.target_url}</a>
          <p className="mt-2 text-xs text-muted-foreground">
            Every {formatInterval(monitor.interval_sec)} · up to {monitor.max_nodes} nodes
            {monitor.country_codes.length ? ` · ${monitor.country_codes.join(", ")}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => check.mutate()} disabled={check.isPending}>Check now</Button>
          <Button variant="outline" onClick={() => remove.mutate()}>Delete</Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardHeader><CardTitle className="text-xs text-muted-foreground uppercase">24h uptime</CardTitle></CardHeader><CardContent className="font-mono text-2xl">{formatUptime(monitor.uptime_24h)}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-xs text-muted-foreground uppercase">7d uptime</CardTitle></CardHeader><CardContent className="font-mono text-2xl">{formatUptime(monitor.uptime_7d)}</CardContent></Card>
        <Card>
          <CardHeader><CardTitle className="text-xs text-muted-foreground uppercase">Share</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {monitor.public_enabled && monitor.public_slug ? (
              <Link className="underline-offset-4 hover:underline" href={`/status/${monitor.public_slug}`}>{appUrl}/status/{monitor.public_slug}</Link>
            ) : (
              <span className="text-muted-foreground">Private</span>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Locations</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!run || run.results.length === 0 ? <p className="text-sm text-muted-foreground">No online agents in this pool yet. Enroll a machine or widen the group filter.</p> : null}
          {run?.results.map((result) => (
            <div key={result.id} className="grid items-center gap-2 border-b pb-3 last:border-0 sm:grid-cols-[180px_1fr_auto]">
              <div>
                <div className="text-sm font-medium">{locationLabel(result.city, result.country_code, result.node_name)}</div>
                <div className="text-xs text-muted-foreground">{result.node_name}</div>
              </div>
              {result.status === "pending" ? <LoadBar /> : <StatusPill status={result.status} label={result.error || result.status} />}
              <div className="font-mono text-xs text-muted-foreground">
                {result.status === "pending" ? "checking" : `${formatMs(result.total_ms)} · HTTP ${result.http_status ?? "—"} · ping ${formatMs(result.ping_ms)}`}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Latency</CardTitle></CardHeader>
        <CardContent><LatencyChart points={monitor.points} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Uptime, last 24 hours</CardTitle></CardHeader>
        <CardContent><UptimeChart buckets={monitor.buckets} /></CardContent>
      </Card>
    </div>
  );
}
