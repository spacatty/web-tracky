"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { StatusPill } from "@/components/status-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api";
import { formatAgo, formatInterval, formatUptime, intervalStops } from "@/lib/format";
import type { Group, Monitor, PublicConfig } from "@/lib/types";

export default function MonitorsPage() {
  const router = useRouter();
  const client = useQueryClient();
  const monitors = useQuery({ queryKey: ["monitors"], queryFn: () => api<Monitor[]>("/api/monitors"), refetchInterval: 5000 });
  const [open, setOpen] = useState(false);
  const columns = useMemo<ColumnDef<Monitor>[]>(
    () => [
      { accessorKey: "name", header: "Monitor", cell: ({ row }) => <div className="font-medium">{row.original.name}</div> },
      { accessorKey: "target_url", header: "URL", cell: ({ row }) => <span className="font-mono text-xs">{row.original.target_url}</span> },
      { id: "status", header: "Status", accessorFn: (row) => row.last_status, cell: ({ row }) => <StatusPill status={row.original.last_status} /> },
      { id: "uptime", header: "24h", accessorFn: (row) => row.uptime_24h ?? -1, cell: ({ row }) => <span className="font-mono text-xs">{formatUptime(row.original.uptime_24h)}</span> },
      { id: "interval", header: "Every", accessorFn: (row) => row.interval_sec, cell: ({ row }) => formatInterval(row.original.interval_sec) },
      {
        id: "pool",
        header: "Pool",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.groups.map((group) => (
              <Badge key={group.id} variant="secondary">{group.name}</Badge>
            ))}
          </div>
        ),
      },
      { id: "checked", header: "Checked", cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatAgo(row.original.last_checked_at)}</span> },
    ],
    [],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Checks</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Monitors</h1>
        </div>
        <Button onClick={() => setOpen(true)}>Add website</Button>
      </div>
      <DataTable
        columns={columns}
        data={monitors.data ?? []}
        searchPlaceholder="Search monitors"
        onRowClick={(monitor) => router.push(`/monitors/${monitor.id}`)}
        empty="Add a URL to start checking it from your nodes."
      />
      <CreateMonitor
        open={open}
        onOpenChange={setOpen}
        onCreated={(id) => {
          client.invalidateQueries({ queryKey: ["monitors"] });
          router.push(`/monitors/${id}`);
        }}
      />
    </div>
  );
}

function CreateMonitor({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: string) => void }) {
  const config = useQuery({ queryKey: ["config"], queryFn: () => api<PublicConfig>("/api/config") });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<Group[]>("/api/groups"), enabled: open });
  const stops = intervalStops(config.data?.min_interval_sec ?? 30);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("https://");
  const [index, setIndex] = useState(1);
  const [maxNodes, setMaxNodes] = useState(20);
  const [countries, setCountries] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [share, setShare] = useState(false);
  const [groupIDs, setGroupIDs] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: () =>
      api<Monitor>("/api/monitors", {
        method: "POST",
        body: JSON.stringify({
          name,
          target_url: url,
          interval_sec: stops[Math.min(index, stops.length - 1)],
          enabled,
          public_enabled: share,
          country_codes: countries.split(/[,\s]+/).filter(Boolean),
          max_nodes: maxNodes,
          group_ids: groupIDs,
        }),
      }),
    onSuccess: (monitor) => {
      toast.success("Monitor created");
      onOpenChange(false);
      onCreated(monitor.id);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not create monitor"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Track a website</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>URL</Label>
            <Input value={url} onChange={(event) => setUrl(event.target.value)} required />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <Label>Interval</Label>
              <span className="font-mono text-xs">{formatInterval(stops[Math.min(index, stops.length - 1)] ?? 60)}</span>
            </div>
            <Slider min={0} max={Math.max(stops.length - 1, 1)} step={1} value={[Math.min(index, stops.length - 1)]} onValueChange={(value) => setIndex(Array.isArray(value) ? value[0] : value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Max nodes</Label>
              <Input type="number" min={1} max={100} value={maxNodes} onChange={(event) => setMaxNodes(Number(event.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Countries</Label>
              <Input value={countries} onChange={(event) => setCountries(event.target.value)} placeholder="DE, US" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Pool</Label>
            {(groups.data ?? []).map((group) => (
              <label key={group.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={groupIDs.includes(group.id)}
                  onCheckedChange={(checked) =>
                    setGroupIDs((current) => (checked ? [...current, group.id] : current.filter((id) => id !== group.id)))
                  }
                />
                {group.name}
                <span className="text-xs text-muted-foreground">{group.visibility}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <Label>Enabled</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div className="flex items-center justify-between">
            <Label>Public status page</Label>
            <Switch checked={share} onCheckedChange={setShare} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
