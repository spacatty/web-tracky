"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { MonitorPanel } from "@/components/monitor-panel";
import { SuccessRulesField } from "@/components/success-rules";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import { formatInterval } from "@/lib/format";
import { blankRule, compileRules, describeSuccess, toDraft, type DraftRule } from "@/lib/success";
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
  const [rulesOpen, setRulesOpen] = useState(false);
  const [customSuccess, setCustomSuccess] = useState(false);
  const [successRules, setSuccessRules] = useState<DraftRule[]>([blankRule()]);
  const saveRules = useMutation({
    mutationFn: () => {
      const compiled = compileRules(customSuccess, successRules);
      if (!compiled.ok) return Promise.reject(new Error(compiled.error));
      return api(`/api/monitors/${id}`, { method: "PATCH", body: JSON.stringify({ success_rules: compiled.rules }) });
    },
    onSuccess: () => {
      toast.success("Success rules updated");
      setRulesOpen(false);
      client.invalidateQueries({ queryKey: ["monitor", id] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : error instanceof Error ? error.message : "Could not update rules"),
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

  const shareHref = monitor.public_enabled && monitor.public_slug ? `${appUrl}/status/${monitor.public_slug}` : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{monitor.name}</h1>
            <StatusPill status={monitor.last_status} />
          </div>
          <a href={monitor.target_url} className="font-mono text-xs text-muted-foreground hover:text-foreground">{monitor.target_url}</a>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Every {formatInterval(monitor.interval_sec)} · up to {monitor.max_nodes} nodes
            {monitor.country_codes.length ? ` · ${monitor.country_codes.join(", ")}` : ""}
            {" · "}
            <Button
              type="button"
              variant="link"
              className="h-auto px-0 text-[11px] font-normal text-muted-foreground"
              onClick={() => {
                const next = toDraft(monitor.success_rules);
                setCustomSuccess(next.enabled);
                setSuccessRules(next.rules);
                setRulesOpen(true);
              }}
            >
              Success {describeSuccess(monitor.success_rules)}
            </Button>
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => check.mutate()} disabled={check.isPending}>Check now</Button>
          <Button variant="outline" onClick={() => remove.mutate()}>Delete</Button>
        </div>
      </div>
      <MonitorPanel monitor={monitor} run={run} shareHref={shareHref} />
      <Dialog open={rulesOpen} onOpenChange={setRulesOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Success rules</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              saveRules.mutate();
            }}
          >
            <SuccessRulesField enabled={customSuccess} rules={successRules} onEnabledChange={setCustomSuccess} onChange={setSuccessRules} />
            <DialogFooter>
              <Button type="submit" disabled={saveRules.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
