"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";

import { MonitorPanel } from "@/components/monitor-panel";
import { StatusPill } from "@/components/status-pill";
import { api } from "@/lib/api";
import { formatInterval } from "@/lib/format";
import { describeSuccess } from "@/lib/success";
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="mt-1 flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{monitor.name}</h1>
                <StatusPill status={monitor.last_status} />
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{monitor.target_url}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Every {formatInterval(monitor.interval_sec)} · Success {describeSuccess(monitor.success_rules)}
              </p>
            </div>
          </div>
          <MonitorPanel monitor={monitor} run={monitor.latest_run} />
        </div>
      )}
    </main>
  );
}
