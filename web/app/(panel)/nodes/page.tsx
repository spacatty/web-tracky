"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { LocationLabel } from "@/components/location";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ApiError, api } from "@/lib/api";
import { formatAgo, formatLink, formatMs, formatRate, formatSpeed, locationLabel } from "@/lib/format";
import type { FleetNode, Group, MetricPoint, Me } from "@/lib/types";

const chartConfig = {
  rx_bps: { label: "Receive", color: "var(--chart-1)" },
  tx_bps: { label: "Transmit", color: "var(--chart-2)" },
  down_bps: { label: "Download test", color: "var(--chart-3)" },
  up_bps: { label: "Upload test", color: "var(--chart-4)" },
} satisfies ChartConfig;

type PendingRefresh = { speedAt: string | null; token: number };

export default function NodesPage() {
  const client = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/auth/me") });
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: () => api<FleetNode[]>("/api/nodes"), refetchInterval: 5000 });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<Group[]>("/api/groups") });
  const [selected, setSelected] = useState<FleetNode | null>(null);
  const [pending, setPending] = useState<Record<string, PendingRefresh>>({});
  const refreshToken = useRef(0);
  const seenSpeed = useRef<Record<string, string | null>>({});
  const admin = me.data?.role === "admin";

  const queueRefresh = (node: FleetNode) => {
    const token = ++refreshToken.current;
    setPending((current) => ({ ...current, [node.id]: { speedAt: node.speed_at, token } }));
    window.setTimeout(() => {
      setPending((current) => {
        const entry = current[node.id];
        if (!entry || entry.token !== token) return current;
        toast.error(`${node.name} did not report a new measurement`);
        const next = { ...current };
        delete next[node.id];
        return next;
      });
    }, 45000);
  };

  const refreshOne = useMutation({
    mutationFn: (node: FleetNode) => api(`/api/nodes/${node.id}/refresh`, { method: "POST" }),
    onSuccess: (_data, node) => {
      queueRefresh(node);
      toast.success(node.online ? `Measuring ${node.name}` : `Queued for ${node.name}`);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not refresh metrics"),
  });
  const refreshAll = useMutation({
    mutationFn: () => api<{ count: number }>("/api/nodes/refresh", { method: "POST" }),
    onSuccess: (result) => {
      for (const node of nodes.data ?? []) {
        if (node.online) queueRefresh(node);
      }
      toast.success(result.count === 0 ? "No online machines to measure" : `Measuring ${result.count} machine${result.count === 1 ? "" : "s"}`);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not refresh metrics"),
  });

  useEffect(() => {
    if (!nodes.data) return;
    setPending((current) => {
      let changed = false;
      const next = { ...current };
      for (const node of nodes.data ?? []) {
        const entry = next[node.id];
        if (entry && entry.speedAt !== node.speed_at) {
          delete next[node.id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
    for (const node of nodes.data) {
      const prev = seenSpeed.current[node.id];
      if (prev !== undefined && prev !== node.speed_at) {
        void client.invalidateQueries({ queryKey: ["node-metrics", node.id] });
      }
      seenSpeed.current[node.id] = node.speed_at;
    }
  }, [nodes.data, client]);

  const columns = useMemo<ColumnDef<FleetNode>[]>(
    () => [
      {
        id: "name",
        accessorFn: (row) => [row.name, row.hostname, row.ip].filter(Boolean).join(" "),
        header: "Node",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span
              className={`size-2 shrink-0 rounded-full ${updateBusy(row.original) ? "bg-amber-400" : row.original.online ? "bg-emerald-500" : "bg-red-500"}`}
              title={updateBusy(row.original) ? "Updating" : row.original.online ? "Online" : "Offline"}
            />
            <div className="min-w-0">
              <div className="font-medium">{row.original.name}</div>
              <div className="text-xs text-muted-foreground">{row.original.hostname || row.original.os || "—"}</div>
              {row.original.ip ? <CopyIP ip={row.original.ip} /> : null}
            </div>
          </div>
        ),
      },
      {
        id: "speed",
        header: "Speed",
        accessorFn: (row) => row.down_bps + row.up_bps,
        cell: ({ row }) => (
          <span
            className="font-mono text-xs"
            title={row.original.speed_at ? `Tested ${formatAgo(row.original.speed_at)}` : "Not tested yet"}
          >
            ↓ {formatSpeed(row.original.down_bps)} ↑ {formatSpeed(row.original.up_bps)}
          </span>
        ),
      },
      {
        id: "link",
        header: "Link",
        accessorFn: (row) => row.adapter,
        cell: ({ row }) => (
          <span className="text-xs">
            {row.original.adapter || "—"} · {formatLink(row.original.link_speed_bps)}
          </span>
        ),
      },
      {
        id: "location",
        header: "Location",
        accessorFn: (row) => locationLabel(row.city, row.country_code, row.country),
        cell: ({ row }) => (
          <LocationLabel city={row.original.city} code={row.original.country_code} name={row.original.country} />
        ),
      },
      {
        id: "groups",
        header: "Groups",
        accessorFn: (row) => row.groups.map((group) => group.name).join(" "),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.groups.map((group) => (
              <Badge key={group.id} variant="secondary">{group.name}</Badge>
            ))}
          </div>
        ),
      },
      {
        id: "seen",
        header: "Seen",
        accessorFn: (row) => row.last_seen_at ?? "",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatAgo(row.original.last_seen_at)}</span>,
      },
      {
        id: "ping",
        header: "RTT",
        accessorFn: (row) => row.api_rtt_ms ?? -1,
        cell: ({ row }) => <span className="font-mono text-xs">{formatMs(row.original.api_rtt_ms)}</span>,
      },
      {
        id: "core",
        header: "Core",
        accessorFn: (row) => row.core_version,
        cell: ({ row }) => (
          <div className="space-y-1">
            <div className="font-mono text-xs">{row.original.core_version || "—"}</div>
            <UpdateMark node={row.original} />
          </div>
        ),
      },
      ...(admin
        ? [
            {
              id: "refresh",
              header: "",
              enableHiding: false,
              enableSorting: false,
              cell: ({ row }) => {
                const measuring = Boolean(pending[row.original.id]);
                return (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={measuring ? "Measuring speed" : "Refresh metrics"}
                    disabled={measuring}
                    onClick={(event) => {
                      event.stopPropagation();
                      refreshOne.mutate(row.original);
                    }}
                  >
                    <RefreshCwIcon className={measuring ? "animate-spin" : ""} />
                  </Button>
                );
              },
            } satisfies ColumnDef<FleetNode>,
          ]
        : []),
    ],
    [admin, pending, refreshOne],
  );

  const liveSelected = selected ? (nodes.data?.find((node) => node.id === selected.id) ?? selected) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Agents</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Nodes</h1>
          <p className="mt-1 text-sm text-muted-foreground">Heartbeat, location, and measured download and upload speed from each machine.</p>
        </div>
        {admin ? (
          <Button variant="outline" onClick={() => refreshAll.mutate()} disabled={refreshAll.isPending}>
            <RefreshCwIcon className={refreshAll.isPending ? "animate-spin" : ""} />
            Refresh metrics
          </Button>
        ) : null}
      </div>
      <DataTable columns={columns} data={nodes.data ?? []} searchPlaceholder="Search nodes" onRowClick={setSelected} empty="No machines enrolled yet." />
      <NodeSheet
        node={liveSelected}
        admin={admin}
        groups={groups.data ?? []}
        refreshing={Boolean(liveSelected && pending[liveSelected.id])}
        onRefresh={() => liveSelected && refreshOne.mutate(liveSelected)}
        onClose={() => setSelected(null)}
        onSaved={() => {
          client.invalidateQueries({ queryKey: ["nodes"] });
          client.invalidateQueries({ queryKey: ["groups"] });
        }}
      />
    </div>
  );
}

function NodeSheet({
  node,
  admin,
  groups,
  refreshing,
  onRefresh,
  onClose,
  onSaved,
}: {
  node: FleetNode | null;
  admin: boolean;
  groups: Group[];
  refreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const metrics = useQuery({
    queryKey: ["node-metrics", node?.id],
    queryFn: () => api<MetricPoint[]>(`/api/nodes/${node?.id}/metrics?hours=6`),
    enabled: Boolean(node),
  });
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [code, setCode] = useState("");
  const [groupIDs, setGroupIDs] = useState<string[]>([]);
  const [seen, setSeen] = useState<string | null>(null);
  if (node && seen !== node.id) {
    setSeen(node.id);
    setName(node.name);
    setCity(node.city);
    setCountry(node.country);
    setCode(node.country_code);
    setGroupIDs(node.groups.map((group) => group.id));
  }
  const save = useMutation({
    mutationFn: () =>
      api(`/api/nodes/${node?.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          city,
          country,
          country_code: code,
          group_ids: groupIDs,
        }),
      }),
    onSuccess: () => {
      toast.success("Node updated");
      onSaved();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not save"),
  });

  return (
    <Sheet open={Boolean(node)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-lg">
        {node ? (
          <>
            <SheetHeader>
              <SheetTitle>{node.name}</SheetTitle>
              <SheetDescription>
                <LocationLabel city={node.city} code={node.country_code} name={node.country} className="block" />
                <span className="mt-1 block font-mono">{node.hostname || "—"}</span>
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-6">
              {node.ip ? <CopyIP ip={node.ip} /> : null}
              <UpdatePanel node={node} />
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Meta label="Link" value={node.adapter ? `${node.adapter} · ${formatLink(node.link_speed_bps)}` : formatLink(node.link_speed_bps)} />
                <Meta label="Throughput" value={`↓ ${formatRate(node.rx_bps)}  ↑ ${formatRate(node.tx_bps)}`} />
                <Meta label="Download" value={formatSpeed(node.down_bps)} />
                <Meta label="Upload" value={formatSpeed(node.up_bps)} />
                <Meta label="API RTT" value={formatMs(node.api_rtt_ms)} />
                <Meta label="Speed test" value={refreshing ? "Measuring…" : node.speed_at ? formatAgo(node.speed_at) : "—"} />
                <Meta label="OS" value={[node.os, node.arch].filter(Boolean).join(" ") || "—"} />
                <Meta label="Kernel" value={node.kernel || "—"} />
                <Meta label="Core" value={node.core_version || "—"} />
                <Meta label="Pack" value={node.pack_version ? String(node.pack_version) : "—"} />
                <Meta label="Last seen" value={formatAgo(node.last_seen_at)} />
                <Meta label="Enrolled" value={formatAgo(node.created_at)} />
              </div>
              <SampleFacts sample={node.last_sample} />
              {admin ? (
                <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={onRefresh}>
                  <RefreshCwIcon className={refreshing ? "animate-spin" : ""} />
                  {refreshing ? "Measuring" : "Refresh metrics"}
                </Button>
              ) : null}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Last 6 hours</p>
                <ChartContainer config={chartConfig} className="aspect-auto h-36 w-full">
                  <AreaChart data={metrics.data ?? []} margin={{ left: 4, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="t"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={28}
                      tickFormatter={(value) => new Date(String(value)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(_, payload) => {
                            const row = payload?.[0]?.payload as MetricPoint | undefined;
                            return row ? new Date(row.t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
                          }}
                          formatter={(value, name) => [name === "rx_bps" || name === "tx_bps" ? formatRate(Number(value)) : formatSpeed(Number(value)), chartConfig[name as keyof typeof chartConfig]?.label ?? name]}
                        />
                      }
                    />
                    <Area dataKey="rx_bps" stroke="var(--color-rx_bps)" fill="var(--color-rx_bps)" fillOpacity={0.2} />
                    <Area dataKey="tx_bps" stroke="var(--color-tx_bps)" fill="var(--color-tx_bps)" fillOpacity={0.15} />
                  </AreaChart>
                </ChartContainer>
              </div>
              {admin ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    save.mutate();
                  }}
                >
                  <Field label="Name" value={name} onChange={setName} />
                  <Field label="City" value={city} onChange={setCity} />
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Country" value={country} onChange={setCountry} />
                    <Field label="Code" value={code} onChange={setCode} />
                  </div>
                  <div className="space-y-2">
                    <Label>Groups</Label>
                    {groups.map((group) => (
                      <Label key={group.id} className="font-normal">
                        <Checkbox
                          checked={groupIDs.includes(group.id)}
                          onCheckedChange={(checked) =>
                            setGroupIDs((current) =>
                              checked ? [...current, group.id] : current.filter((id) => id !== group.id),
                            )
                          }
                        />
                        {group.name}
                        <span className="text-xs text-muted-foreground">{group.visibility}</span>
                      </Label>
                    ))}
                  </div>
                  <Button type="submit" disabled={save.isPending}>Save</Button>
                </form>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

const updatePhases = ["downloading", "verifying", "installing", "restarting"] as const;

function updateBusy(node: FleetNode) {
  return updatePhases.includes(node.update_status as (typeof updatePhases)[number]);
}

function updateLabel(status: string) {
  switch (status) {
    case "downloading":
      return "Downloading";
    case "verifying":
      return "Verifying";
    case "installing":
      return "Installing";
    case "restarting":
      return "Restarting";
    case "failed":
      return "Failed";
    case "stalled":
      return "Stalled";
    default:
      return status;
  }
}

function UpdateMark({ node }: { node: FleetNode }) {
  if (updateBusy(node) || node.update_status === "stalled") {
    return <span className="text-[11px] text-amber-500">{updateLabel(node.update_status)}{node.update_status === "downloading" ? ` ${node.update_progress}%` : ""}</span>;
  }
  if (node.update_status === "failed") {
    return <span className="text-[11px] text-destructive" title={node.update_error}>Failed</span>;
  }
  if (node.core_latest && node.core_version && node.core_version !== node.core_latest) {
    return <span className="text-[11px] text-muted-foreground">Behind {node.core_latest}</span>;
  }
  return null;
}

function UpdatePanel({ node }: { node: FleetNode }) {
  const active = updatePhases.indexOf(node.update_status as (typeof updatePhases)[number]);
  const behind = Boolean(node.core_latest && node.core_version && node.core_version !== node.core_latest);
  const showSteps = active >= 0 || node.update_status === "failed" || node.update_status === "stalled";
  if (!showSteps && !behind && !node.core_latest) return null;
  return (
    <div className="space-y-2 rounded-lg border px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Agent core</span>
        <span className="font-mono">
          {node.core_version || "—"}
          {node.core_latest ? ` / ${node.core_latest}` : ""}
        </span>
      </div>
      {showSteps ? (
        <ol className="space-y-1">
          {updatePhases.map((phase, index) => {
            const done = active > index;
            const current = node.update_status === phase;
            return (
              <li key={phase} className={current ? "text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/60"}>
                {done ? "✓ " : current ? "→ " : "· "}
                {updateLabel(phase)}
                {current && phase === "downloading" ? ` ${node.update_progress}%` : ""}
              </li>
            );
          })}
        </ol>
      ) : null}
      {node.update_status === "downloading" ? (
        <span className="block h-1 overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full bg-primary" style={{ width: `${node.update_progress}%` }} />
        </span>
      ) : null}
      {node.update_status === "failed" ? <p className="text-destructive">{node.update_error || "Update failed"}</p> : null}
      {node.update_status === "stalled" ? <p className="text-amber-500">The update stopped reporting. It will retry on the next heartbeat.</p> : null}
      {!showSteps && behind ? (
        <p className="text-muted-foreground">Idle machines replace their own binary. This one updates the next time it has no checks in flight.</p>
      ) : null}
      {!showSteps && !behind && node.core_latest ? <p className="text-muted-foreground">Running the published release.</p> : null}
    </div>
  );
}

function CopyIP({ ip }: { ip: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      title="Copy IP"
      className="h-auto max-w-full cursor-copy justify-start truncate px-1 font-mono text-[11px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard.writeText(ip).then(
          () => toast.success("IP copied"),
          () => toast.error("Could not copy IP"),
        );
      }}
    >
      {ip}
    </Button>
  );
}

const shownSample = new Set([
  "host.hostname",
  "host.os",
  "host.arch",
  "host.kernel",
  "net.adapter",
  "net.rx_bps",
  "net.tx_bps",
  "net.link_speed_bps",
  "speed.ok",
  "speed.down_bps",
  "speed.up_bps",
  "speed.measured_at",
]);

function SampleFacts({ sample }: { sample?: Record<string, unknown> }) {
  const rows = flattenSample(sample).filter((row) => !shownSample.has(row.path) && row.value !== "");
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Collected</p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {rows.map((row) => (
          <Meta key={row.path} label={row.label} value={row.value} />
        ))}
      </div>
    </div>
  );
}

function flattenSample(sample: Record<string, unknown> | undefined, prefix = ""): { path: string; label: string; value: string }[] {
  if (!sample) return [];
  const rows: { path: string; label: string; value: string }[] = [];
  for (const [key, value] of Object.entries(sample)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      rows.push(...flattenSample(value as Record<string, unknown>, path));
      continue;
    }
    rows.push({ path, label: labelFor(path), value: formatFact(path, value) });
  }
  return rows;
}

function labelFor(path: string) {
  const name = path.split(".").pop() ?? path;
  return name.replaceAll("_", " ");
}

function formatFact(path: string, value: unknown) {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    if (path.endsWith("_bps")) return formatSpeed(value) === "—" ? formatRate(value) : formatSpeed(value);
    if (path.endsWith("_ms")) return formatMs(value);
    return String(value);
  }
  return String(value);
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border px-2.5 py-2">
      <div className="text-muted-foreground capitalize">{label}</div>
      <div className="font-mono break-all">{value}</div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
