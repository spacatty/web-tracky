"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { ChartRangePicker, useChartRange } from "@/components/chart-range";
import { LatencyChart, UptimeChart } from "@/components/latency-chart";
import { LoadBar } from "@/components/load-bar";
import { StatusPill } from "@/components/status-pill";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LocationLabel } from "@/components/location";
import { api } from "@/lib/api";
import { formatMs, formatUptime } from "@/lib/format";
import { presetLabel, rangeQuery } from "@/lib/range";
import type { CheckRun, MonitorDetail, MonitorSeries } from "@/lib/types";

export function MonitorPanel({
  monitor,
  run,
  shareHref,
  seriesPath,
}: {
  monitor: MonitorDetail;
  run: CheckRun | null;
  shareHref?: string | null;
  seriesPath: string;
}) {
  const range = useChartRange();
  const series = useQuery({
    queryKey: ["monitor-series", seriesPath, range.preset, range.preset === "custom" ? range.from.toISOString() : "", range.preset === "custom" ? range.to.toISOString() : ""],
    queryFn: () => api<MonitorSeries>(`${seriesPath}?${rangeQuery(range.window)}`),
    placeholderData: keepPreviousData,
    refetchInterval: range.preset === "custom" ? false : 15000,
  });
  const points = series.data?.points ?? (range.preset === "24h" ? monitor.points : []);
  const buckets = series.data?.buckets ?? (range.preset === "24h" ? monitor.buckets : []);
  const results = run?.results ?? [];
  return (
    <div className="space-y-3">
      <Card size="sm">
        <CardHeader>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <CardTitle>Latency</CardTitle>
            <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                24h <span className="font-mono text-foreground">{formatUptime(monitor.uptime_24h)}</span>
              </span>
              <span>
                7d <span className="font-mono text-foreground">{formatUptime(monitor.uptime_7d)}</span>
              </span>
              {shareHref ? (
                <a href={shareHref} className="max-w-48 truncate font-mono hover:text-foreground">
                  {shareHref.replace(/^https?:\/\//, "")}
                </a>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ChartRangePicker
            preset={range.preset}
            from={range.from}
            to={range.to}
            onPreset={range.selectPreset}
            onFrom={range.selectFrom}
            onTo={range.selectTo}
          />
          {series.isLoading && points.length === 0 ? <Skeleton className="h-80 w-full" /> : null}
          {series.isError && points.length === 0 ? <p className="text-sm text-muted-foreground">Could not load this range.</p> : null}
          {points.length > 0 || (!series.isLoading && !series.isError) ? (
            <div className={series.isFetching ? "opacity-70 transition-opacity" : undefined}>
              <LatencyChart points={points} from={range.from} to={range.to} />
            </div>
          ) : null}
          <div>
            <p className="mb-1 text-[11px] text-muted-foreground">Uptime · {presetLabel(range.preset)}</p>
            {series.isLoading && buckets.length === 0 ? <Skeleton className="h-8 w-full" /> : <UptimeChart buckets={buckets} className="h-8" />}
          </div>
        </CardContent>
      </Card>
      <Card size="sm">
        <CardHeader className="pb-1">
          <CardTitle>Locations</CardTitle>
        </CardHeader>
        <CardContent>
          {results.length === 0 ? <p className="text-sm text-muted-foreground">No online agents in this pool yet.</p> : null}
          {results.map((result) => (
            <div key={result.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b py-2 last:border-0">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <LocationLabel city={result.city} code={result.country_code} name={result.node_name} className="text-sm font-medium" />
                  {result.status === "pending" ? null : <StatusPill status={result.status} />}
                </div>
                {result.error ? <div className="truncate text-[11px] text-muted-foreground">{result.error}</div> : null}
              </div>
              {result.status === "pending" ? (
                <div className="w-28">
                  <LoadBar />
                </div>
              ) : (
                <div className="text-right">
                  <div className="font-mono text-sm font-medium tabular-nums">{formatMs(result.total_ms)}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    HTTP {result.http_status ?? "—"}
                    <span className="text-muted-foreground/70"> · ping {formatMs(result.ping_ms)}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
