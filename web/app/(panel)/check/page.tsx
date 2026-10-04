"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { GroupChecks } from "@/components/group-checks";
import { LinkListField } from "@/components/link-list-field";
import { LocationLabel } from "@/components/location";
import { LoadBar } from "@/components/load-bar";
import { PresetSelect } from "@/components/preset-select";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { formatAgo, formatMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SpotCheck, SpotSummary } from "@/lib/types";

export default function CheckPage() {
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [groupIDs, setGroupIDs] = useState<string[]>([]);
  const [preset, setPreset] = useState("default");
  const [maxNodes, setMaxNodes] = useState(20);
  const [activeID, setActiveID] = useState<string | null>(null);

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
    onError: (error) => toast.error(errorMessage(error, "Could not start the check")),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Checks</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">One-off check</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">Check a list of links once from the groups you pick, using a status preset. Nothing is saved as a monitor.</p>
      </div>
      <form
        className="space-y-3 rounded-lg border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          run.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Links</Label>
          <LinkListField
            value={text}
            onChange={setText}
            placeholder={"https://example.com\nSome Service https://api.example.com/missing\nhttps://a.example, https://b.example"}
          />
          <p className="text-xs text-muted-foreground">Up to 50 links. One per line, several separated by commas, or a .txt file. A name before a link is kept as the label.</p>
        </div>
        <GroupChecks ids={groupIDs} onChange={setGroupIDs} />
        <PresetSelect value={preset} onChange={setPreset} />
        <div className="max-w-40 space-y-1.5">
          <Label>Max nodes</Label>
          <Input type="number" min={1} max={100} value={maxNodes} onChange={(event) => setMaxNodes(Number(event.target.value))} />
        </div>
        <Button type="submit" disabled={run.isPending || !text.trim() || groupIDs.length === 0}>
          {run.isPending ? "Starting" : "Check links"}
        </Button>
      </form>
      {activeID ? <SpotResults check={active.data} loading={active.isLoading} /> : null}
      <div className="space-y-2">
        <h2 className="text-sm font-medium">Recent checks</h2>
        {(recent.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No one-off checks yet.</p> : null}
        <div className="divide-y rounded-lg border">
          {(recent.data ?? []).map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setActiveID(row.id)}
              className={cn("flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50", activeID === row.id && "bg-muted/60")}
            >
              <div className="min-w-0">
                <div className="truncate text-sm">
                  {row.template_name || "Default"} · {row.url_count} link{row.url_count === 1 ? "" : "s"}
                </div>
                <div className="text-xs text-muted-foreground">{formatAgo(row.created_at)}</div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{summaryLabel(row)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SpotResults({ check, loading }: { check?: SpotCheck; loading: boolean }) {
  if (!check) {
    return loading ? <p className="text-sm text-muted-foreground">Loading results…</p> : null;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Results</h2>
        <p className="text-xs text-muted-foreground">
          {check.template_name || "Default"} · {formatAgo(check.created_at)}
          {check.groups.length ? ` · ${check.groups.map((group) => group.name).join(", ")}` : ""}
        </p>
      </div>
      <div className="rounded-lg border px-3">
        {check.targets.map((target) => (
          <details key={target.url} className="group border-b py-2 last:border-0">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
              <div className="min-w-0">
                {target.name && !target.url.includes(target.name) ? <div className="truncate text-sm font-medium">{target.name}</div> : null}
                <div className="truncate font-mono text-xs text-muted-foreground">{target.url}</div>
              </div>
              <StatusPill status={target.status === "unknown" ? "unknown" : target.status} label={target.status === "unknown" ? "no agents" : undefined} />
            </summary>
            <div className="mt-2 border-t pt-1">
              {(target.run?.results.length ?? 0) === 0 ? <p className="py-2 text-sm text-muted-foreground">No online agents in this pool.</p> : null}
              {target.run?.results.map((result) => (
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
                      <div className="font-mono text-[11px] text-muted-foreground">HTTP {result.http_status ?? "—"}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
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
  if (row.ok) parts.push(`${row.ok} ok`);
  if (row.fail) parts.push(`${row.fail} fail`);
  if (unknown) parts.push(`${unknown} unchecked`);
  return parts.join(" · ") || "No results";
}
