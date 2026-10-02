"use client";

import { cn } from "cn";
import { CartesianGrid, Line, LineChart, XAxis, YAxis, Bar, BarChart } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { LatencyPoint, UptimeBucket } from "@/lib/types";

const palette = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function LatencyChart({ points, className }: { points: LatencyPoint[]; className?: string }) {
  const series = new Map<string, string>();
  const rows = new Map<string, Record<string, string | number>>();
  for (const point of points) {
    const key = point.node_id || point.label;
    if (!series.has(key)) series.set(key, point.label);
    const row = rows.get(point.t) ?? { t: point.t };
    row[key] = Math.round(point.total_ms);
    rows.set(point.t, row);
  }
  const config: ChartConfig = {};
  let index = 0;
  for (const [key, label] of series) {
    config[key] = { label, color: palette[index % palette.length] };
    index += 1;
  }
  const data = [...rows.values()];
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">Latency appears after the first completed check.</p>;
  }
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-80 w-full", className)}>
      <LineChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="t"
          tickLine={false}
          axisLine={false}
          minTickGap={28}
          tickFormatter={(value) =>
            new Date(String(value)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          }
        />
        <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(value) => `${value}`} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {[...series.keys()].map((key) => (
          <Line key={key} type="monotone" dataKey={key} stroke={`var(--color-${key})`} strokeWidth={1.8} dot={false} connectNulls />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

export function UptimeChart({ buckets, className }: { buckets: UptimeBucket[]; className?: string }) {
  const config = { ok_ratio: { label: "Uptime", color: "var(--chart-1)" } } satisfies ChartConfig;
  if (buckets.length === 0) {
    return <p className="text-sm text-muted-foreground">Hourly uptime fills in as checks complete.</p>;
  }
  return (
    <ChartContainer config={config} className={cn("aspect-auto h-14 w-full", className)}>
      <BarChart data={buckets}>
        <XAxis dataKey="t" hide />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as UptimeBucket | undefined;
                return row ? new Date(row.t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" }) : "";
              }}
              formatter={(value) => [`${(Number(value) * 100).toFixed(1)}%`, "uptime"]}
            />
          }
        />
        <Bar dataKey="ok_ratio" fill="var(--color-ok_ratio)" radius={3} />
      </BarChart>
    </ChartContainer>
  );
}
