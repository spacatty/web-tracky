"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart } from "recharts";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { LocationLabel } from "@/components/location";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ApiError, api } from "@/lib/api";
import { formatAgo, formatLink, formatMs, formatSpeed, locationLabel } from "@/lib/format";
import type { FleetNode, Group, MetricPoint, Me } from "@/lib/types";

const chartConfig = {
  down_bps: { label: "Download", color: "var(--chart-1)" },
  up_bps: { label: "Upload", color: "var(--chart-2)" },
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
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`size-2 shrink-0 rounded-full ${row.original.online ? "bg-emerald-500" : "bg-red-500"}`}
                title={row.original.online ? "Online" : "Offline"}
              />
              <span className="font-medium">{row.original.name}</span>
            </div>
            <div className="pl-4 text-xs text-muted-foreground">{row.original.hostname || row.original.os || "—"}</div>
            {row.original.ip ? <div className="pl-4"><CopyIP ip={row.original.ip} /></div> : null}
          </div>
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
        id: "ping",
        header: "API RTT",
        accessorFn: (row) => row.api_rtt_ms ?? -1,
        cell: ({ row }) => <span className="font-mono text-xs">{formatMs(row.original.api_rtt_ms)}</span>,
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
        id: "seen",
        header: "Seen",
        accessorFn: (row) => row.last_seen_at ?? "",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatAgo(row.original.last_seen_at)}</span>,
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
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {node ? (
          <>
            <SheetHeader>
              <SheetTitle>{node.name}</SheetTitle>
              <SheetDescription>
                <LocationLabel city={node.city} code={node.country_code} name={node.country} className="block" />
                <span className="mt-1 block font-mono">{node.hostname || node.os || "—"}</span>
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-6">
              {node.ip ? <CopyIP ip={node.ip} /> : null}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Meta label="API RTT" value={formatMs(node.api_rtt_ms)} />
                <Meta label="Link" value={formatLink(node.link_speed_bps)} />
                <Meta label="Download" value={formatSpeed(node.down_bps)} />
                <Meta label="Upload" value={formatSpeed(node.up_bps)} />
                <Meta label="Tested" value={refreshing ? "Measuring…" : node.speed_at ? formatAgo(node.speed_at) : "—"} />
                <Meta label="Adapter" value={node.adapter || "—"} />
                <Meta label="OS" value={[node.os, node.arch].filter(Boolean).join(" ") || "—"} />
              </div>
              {admin ? (
                <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={onRefresh}>
                  <RefreshCwIcon className={refreshing ? "animate-spin" : ""} />
                  {refreshing ? "Measuring" : "Refresh metrics"}
                </Button>
              ) : null}
              <ChartContainer config={chartConfig} className="aspect-auto h-24 w-full">
                <AreaChart data={metrics.data ?? []}>
                  <Area dataKey="down_bps" stroke="var(--color-down_bps)" fill="var(--color-down_bps)" fillOpacity={0.2} />
                  <Area dataKey="up_bps" stroke="var(--color-up_bps)" fill="var(--color-up_bps)" fillOpacity={0.15} />
                </AreaChart>
              </ChartContainer>
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
                      <label key={group.id} className="flex items-center gap-2 text-sm">
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
                      </label>
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

function CopyIP({ ip }: { ip: string }) {
  return (
    <button
      type="button"
      title="Copy IP"
      className="block max-w-full cursor-copy truncate text-left font-mono text-[11px] text-muted-foreground hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard.writeText(ip).then(
          () => toast.success("IP copied"),
          () => toast.error("Could not copy IP"),
        );
      }}
    >
      {ip}
    </button>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-2.5 py-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
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
