"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon, HistoryIcon, Loader2Icon, PlayIcon, RadarIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { GroupChecks } from "@/components/group-checks";
import { LinkListField, countLines } from "@/components/link-list-field";
import { LocationLabel } from "@/components/location";
import { LoadBar } from "@/components/load-bar";
import { PresetSelect } from "@/components/preset-select";
import { StatusDot, StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { formatAgo, formatMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SpotCheck, SpotSummary, SpotTarget } from "@/lib/types";

export default function CheckPage() {
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [groupIDs, setGroupIDs] = useState<string[]>([]);
  const [preset, setPreset] = useState("default");
  const [maxNodes, setMaxNodes] = useState(20);
  const [activeID, setActiveID] = useState<string | null>(null);
  const linkCount = countLines(text);

  const recent = useQuery({
    queryKey: ["spot-checks"],
    queryFn: () => api<SpotSummary[]>("/api/spot-checks"),
    refetchInterval: 5000,
  });
  const active = useQuery({
    queryKey: ["spot-check", activeID],
    queryFn: () => api<SpotCheck>(`/api/spot-checks/${activeID}`),
    enabled: Boolean(activeID),
    refetchInterval: (query) => (isSpotOpen(query.state.data) ? 2000 : false),
  });

  const run = useMutation({
    mutationFn: () =>
      api<SpotCheck>("/api/spot-checks", {
        method: "POST",
        body: JSON.stringify({
          text,
          group_ids: groupIDs,
          template_id: preset === "default" ? "" : preset,
          max_nodes: maxNodes,
        }),
      }),
    onSuccess: (check) => {
      setActiveID(check.id);
      client.setQueryData(["spot-check", check.id], check);
      void client.invalidateQueries({ queryKey: ["spot-checks"] });
      if (check.targets.every((target) => (target.run?.results.length ?? 0) === 0)) {
        toast.message("No online agents in this pool");
      }
    },
    onError: (error) => toast.error(errorMessage(error, "Could not start the probe")),
  });

  const blocker = !text.trim() ? "Add at least one link" : groupIDs.length === 0 ? "Pick a pool" : null;
  const recentRows = recent.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Checks</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Probe</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">Check a list of links once from the pools you pick. Nothing is saved as a monitor.</p>
      </div>

      <form
        className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!blocker) run.mutate();
        }}
      >
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border bg-card p-4 shadow-xs">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <Label className="text-sm">Links</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">One per line or comma-separated. A name before a link becomes its label.</p>
              </div>
            </div>
            <LinkListField
              value={text}
              onChange={setText}
              className="h-56"
              placeholder={"https://example.com\nSome Service https://api.example.com/missing\nhttps://a.example, https://b.example"}
            />
          </section>

          {activeID ? <SpotResults check={active.data} loading={active.isLoading} /> : <ResultsPlaceholder />}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6">
          <section className="space-y-4 rounded-xl border bg-card p-4 shadow-xs">
            <GroupChecks ids={groupIDs} onChange={setGroupIDs} />
            <PresetSelect value={preset} onChange={setPreset} />
            <div className="space-y-1.5">
              <Label htmlFor="max-nodes">Max nodes per link</Label>
              <Input id="max-nodes" type="number" min={1} max={100} value={maxNodes} onChange={(event) => setMaxNodes(Number(event.target.value))} />
            </div>
            <div className="space-y-1.5 border-t pt-4">
              <Button type="submit" className="w-full" disabled={run.isPending || Boolean(blocker)}>
                {run.isPending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
                {run.isPending ? "Starting…" : linkCount > 0 ? `Probe ${linkCount} link${linkCount === 1 ? "" : "s"}` : "Probe links"}
              </Button>
              {blocker && !run.isPending ? <p className="text-center text-xs text-muted-foreground">{blocker}</p> : null}
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
            <div className="flex items-center gap-2 border-b px-4 py-2.5">
              <HistoryIcon className="size-3.5 text-muted-foreground" />
              <h2 className="text-sm font-medium">Recent probes</h2>
              {recentRows.length ? <span className="ml-auto text-xs text-muted-foreground">{recentRows.length}</span> : null}
            </div>
            {recentRows.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{recent.isLoading ? "Loading…" : "No probes yet."}</p>
            ) : (
              <div className="max-h-80 divide-y overflow-y-auto">
                {recentRows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setActiveID(row.id)}
                    className={cn("flex w-full flex-col gap-1.5 px-4 py-2.5 text-left transition-colors hover:bg-muted/50", activeID === row.id && "bg-muted/60")}
                  >
                    <div className="flex w-full items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium">
                        {row.url_count} link{row.url_count === 1 ? "" : "s"}
                        <span className="font-normal text-muted-foreground"> · {row.template_name || "Default"}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{formatAgo(row.created_at)}</span>
                    </div>
                    <OutcomeBar ok={row.ok} fail={row.fail} pending={row.pending} total={row.url_count} />
                    <span className="text-[11px] text-muted-foreground">{summaryLabel(row)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </form>
    </div>
  );
}

function ResultsPlaceholder() {
  return (
    <section className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <RadarIcon className="size-5 text-muted-foreground" />
      </div>
      <p className="mt-3 text-sm font-medium">Results show up here</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">Run a probe or pick one from Recent probes to see how every node saw each link.</p>
    </section>
  );
}

function OutcomeBar({ ok, fail, pending, total }: { ok: number; fail: number; pending: number; total: number }) {
  const pct = (n: number) => `${total > 0 ? (n / total) * 100 : 0}%`;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span className="bg-emerald-500 transition-[width]" style={{ width: pct(ok) }} />
      <span className="bg-destructive transition-[width]" style={{ width: pct(fail) }} />
      <span className="animate-pulse bg-amber-500 transition-[width]" style={{ width: pct(pending) }} />
    </div>
  );
}

function SpotResults({ check, loading }: { check?: SpotCheck; loading: boolean }) {
  if (!check) {
    return (
      <section className="rounded-xl border bg-card p-4">
        <p className="text-sm text-muted-foreground">{loading ? "Loading results…" : "Check not found."}</p>
      </section>
    );
  }
  const total = check.targets.length;
  const ok = check.targets.filter((target) => target.status === "ok").length;
  const fail = check.targets.filter((target) => target.status === "fail").length;
  const pending = check.targets.filter((target) => target.status === "pending").length;
  const none = total - ok - fail - pending;
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="space-y-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            Results
            {pending > 0 ? <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" /> : null}
          </h2>
          <p className="text-xs text-muted-foreground">
            {check.template_name || "Default"} · {formatAgo(check.created_at)}
            {check.groups.length ? ` · ${check.groups.map((group) => group.name).join(", ")}` : ""}
          </p>
        </div>
        <OutcomeBar ok={ok} fail={fail} pending={pending} total={total} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Counter tone="bg-emerald-500" label="up" value={ok} />
          <Counter tone="bg-destructive" label="down" value={fail} />
          {pending ? <Counter tone="bg-amber-500" label="running" value={pending} /> : null}
          {none ? <Counter tone="bg-muted-foreground/40" label="no agents" value={none} /> : null}
        </div>
      </div>
      <div className="divide-y">
        {check.targets.map((target) => (
          <TargetRow key={target.url} target={target} />
        ))}
      </div>
    </section>
  );
}

function Counter({ tone, label, value }: { tone: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", tone)} />
      <span className="font-medium text-foreground tabular-nums">{value}</span>
      {label}
    </span>
  );
}

function TargetRow({ target }: { target: SpotTarget }) {
  const results = target.run?.results ?? [];
  const done = results.filter((result) => result.status !== "pending");
  const okCount = done.filter((result) => result.status === "ok").length;
  const times = done.map((result) => result.total_ms).filter((ms): ms is number => ms !== null).sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : null;
  const showName = target.name && !target.url.includes(target.name);
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <StatusDot status={target.status} />
        <div className="min-w-0 flex-1">
          {showName ? <div className="truncate text-sm font-medium">{target.name}</div> : null}
          <div className={cn("truncate font-mono text-xs", showName ? "text-muted-foreground" : "text-foreground")}>{target.url}</div>
        </div>
        <div className="shrink-0 text-right">
          {target.status === "pending" && done.length === 0 ? (
            <div className="w-20">
              <LoadBar />
            </div>
          ) : results.length === 0 ? (
            <span className="text-xs text-muted-foreground">no agents</span>
          ) : (
            <>
              <div className="font-mono text-sm tabular-nums">{formatMs(median)}</div>
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {okCount}/{results.length} nodes ok
              </div>
            </>
          )}
        </div>
      </summary>
      <div className="border-t bg-muted/20 px-4 py-1 pl-11">
        {results.length === 0 ? <p className="py-2 text-sm text-muted-foreground">No online agents in this pool.</p> : null}
        {results.map((result) => (
          <div key={result.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b py-2 last:border-0">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <LocationLabel city={result.city} code={result.country_code} name={result.node_name} className="text-sm" />
                {result.status === "pending" ? null : <StatusPill status={result.status} />}
              </div>
              {result.error ? <div className="truncate text-[11px] text-destructive/80">{result.error}</div> : null}
            </div>
            {result.status === "pending" ? (
              <div className="w-24">
                <LoadBar />
              </div>
            ) : (
              <div className="text-right">
                <div className="font-mono text-sm tabular-nums">{formatMs(result.total_ms)}</div>
                <div className="font-mono text-[11px] text-muted-foreground">HTTP {result.http_status ?? "—"}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function isSpotOpen(check: SpotCheck | undefined) {
  if (!check) return true;
  return check.pending > 0 || check.targets.some((target) => target.status === "pending" || target.run?.results.some((result) => result.status === "pending"));
}

function summaryLabel(row: SpotSummary) {
  if (row.pending > 0) return `${row.pending} running`;
  const unknown = row.url_count - row.ok - row.fail - row.pending;
  const parts = [];
  if (row.ok) parts.push(`${row.ok} up`);
  if (row.fail) parts.push(`${row.fail} down`);
  if (unknown) parts.push(`${unknown} unchecked`);
  return parts.join(" · ") || "No results";
}
