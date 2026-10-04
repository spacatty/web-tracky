"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, GlobeIcon, LockIcon, PauseIcon, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DeleteMonitorDialog, copyShare, useMonitorActions } from "@/components/monitor-actions";
import { MonitorDialog } from "@/components/monitor-form";
import { MonitorPanel } from "@/components/monitor-panel";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { formatInterval } from "@/lib/format";
import { successLabel } from "@/lib/success";
import type { CheckRun, MonitorDetail, ResultEvent } from "@/lib/types";

export default function MonitorDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["monitor", id], queryFn: () => api<MonitorDetail>(`/api/monitors/${id}`) });
  const [run, setRun] = useState<CheckRun | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { toggle, remove } = useMonitorActions();

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
    onError: (error) => toast.error(errorMessage(error, "Check failed")),
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
  const shareHref = monitor.public_enabled && monitor.public_slug ? `${window.location.origin}/status/${monitor.public_slug}` : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{monitor.name}</h1>
            {monitor.enabled ? <StatusPill status={monitor.last_status} /> : <StatusPill status="unknown" label="paused" />}
          </div>
          <a href={monitor.target_url} className="font-mono text-xs text-muted-foreground hover:text-foreground">{monitor.target_url}</a>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Every {formatInterval(monitor.interval_sec)} · up to {monitor.max_nodes} nodes
            {monitor.country_codes.length ? ` · ${monitor.country_codes.join(", ")}` : ""} · Success {successLabel(monitor.template_name, monitor.success_rules)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {shareHref ? (
              <>
                <span className="inline-flex items-center gap-1">
                  {monitor.public_protected ? <LockIcon className="size-3" /> : <GlobeIcon className="size-3" />}
                  {monitor.public_protected ? "Public page, password protected" : "Public page"}
                </span>
                <Button variant="outline" size="xs" onClick={() => copyShare(monitor)}>
                  <CopyIcon />
                  Copy link
                </Button>
              </>
            ) : (
              <span>Status page off</span>
            )}
            <Button variant="link" size="xs" className="h-auto px-0 text-[11px]" onClick={() => setEditing(true)}>
              {shareHref ? "Sharing settings" : "Enable sharing"}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => check.mutate()} disabled={check.isPending}>Check now</Button>
          <Button variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate(monitor)}>
            {monitor.enabled ? <PauseIcon /> : <PlayIcon />}
            {monitor.enabled ? "Pause" : "Resume"}
          </Button>
          <Button variant="outline" onClick={() => setEditing(true)}>
            <PencilIcon />
            Edit
          </Button>
          <Button variant="destructive" size="icon" title="Delete" onClick={() => setDeleting(true)}>
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <MonitorPanel monitor={monitor} run={run} shareHref={shareHref} seriesPath={`/api/monitors/${id}/series`} />
      <MonitorDialog
        open={editing}
        onOpenChange={setEditing}
        monitor={monitor}
        onSaved={() => {
          void client.invalidateQueries({ queryKey: ["monitor", id] });
          void client.invalidateQueries({ queryKey: ["monitors"] });
        }}
      />
      <DeleteMonitorDialog
        monitor={deleting ? monitor : null}
        pending={remove.isPending}
        onCancel={() => setDeleting(false)}
        onConfirm={(target) => remove.mutate(target, { onSuccess: () => router.push("/monitors") })}
      />
    </div>
  );
}
