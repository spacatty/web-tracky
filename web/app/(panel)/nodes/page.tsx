"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Area, AreaChart } from "recharts";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { StatusPill } from "@/components/status-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ApiError, api } from "@/lib/api";
import { formatAgo, formatLink, formatMs, formatRate, locationLabel } from "@/lib/format";
import type { FleetNode, Group, MetricPoint, Me } from "@/lib/types";

const chartConfig = {
  rx_bps: { label: "In", color: "var(--chart-1)" },
  tx_bps: { label: "Out", color: "var(--chart-2)" },
} satisfies ChartConfig;

export default function NodesPage() {
  const client = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/auth/me") });
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: () => api<FleetNode[]>("/api/nodes"), refetchInterval: 5000 });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<Group[]>("/api/groups") });
  const [selected, setSelected] = useState<FleetNode | null>(null);
  const admin = me.data?.role === "admin";

  const columns = useMemo<ColumnDef<FleetNode>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Node",
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name}</div>
            <div className="text-xs text-muted-foreground">{row.original.hostname || row.original.os}</div>
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (row) => (row.online ? "online" : "offline"),
        cell: ({ row }) => <StatusPill status={row.original.online ? "online" : "offline"} />,
      },
      {
        id: "location",
        header: "Location",
        accessorFn: (row) => locationLabel(row.city, row.country_code, row.country),
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
        id: "traffic",
        header: "Traffic",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            ↓ {formatRate(row.original.rx_bps)} ↑ {formatRate(row.original.tx_bps)}
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
        id: "version",
        header: "Core",
        accessorFn: (row) => `${row.core_version} ${row.pack_version}`,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.core_version || "—"} / p{row.original.pack_version}
          </span>
        ),
      },
      {
        id: "seen",
        header: "Seen",
        accessorFn: (row) => row.last_seen_at ?? "",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatAgo(row.original.last_seen_at)}</span>,
      },
    ],
    [],
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Agents</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Nodes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Heartbeat, location, and interface rates from each enrolled machine.</p>
      </div>
      <DataTable columns={columns} data={nodes.data ?? []} searchPlaceholder="Search nodes" onRowClick={setSelected} empty="No machines enrolled yet." />
      <NodeSheet
        node={selected}
        admin={admin}
        groups={groups.data ?? []}
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
  onClose,
  onSaved,
}: {
  node: FleetNode | null;
  admin: boolean;
  groups: Group[];
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
              <SheetDescription>{locationLabel(node.city, node.country_code, node.country) || "Location unknown"}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-6">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Meta label="API RTT" value={formatMs(node.api_rtt_ms)} />
                <Meta label="Link" value={formatLink(node.link_speed_bps)} />
                <Meta label="In" value={formatRate(node.rx_bps)} />
                <Meta label="Out" value={formatRate(node.tx_bps)} />
                <Meta label="Adapter" value={node.adapter || "—"} />
                <Meta label="OS" value={[node.os, node.arch].filter(Boolean).join(" ") || "—"} />
              </div>
              {admin && node.ip ? <p className="font-mono text-xs text-muted-foreground">{node.ip}</p> : null}
              <ChartContainer config={chartConfig} className="aspect-auto h-24 w-full">
                <AreaChart data={metrics.data ?? []}>
                  <Area dataKey="rx_bps" stroke="var(--color-rx_bps)" fill="var(--color-rx_bps)" fillOpacity={0.2} />
                  <Area dataKey="tx_bps" stroke="var(--color-tx_bps)" fill="var(--color-tx_bps)" fillOpacity={0.15} />
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
