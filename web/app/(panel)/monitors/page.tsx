"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { GlobeIcon, LockIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { DeleteMonitorDialog, MonitorRowActions, useMonitorActions } from "@/components/monitor-actions";
import { ImportMonitorsDialog } from "@/components/import-monitors";
import { MonitorDialog } from "@/components/monitor-form";
import { StatusPill } from "@/components/status-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatAgo, formatInterval, formatUptime } from "@/lib/format";
import type { Monitor } from "@/lib/types";

export default function MonitorsPage() {
  const router = useRouter();
  const client = useQueryClient();
  const monitors = useQuery({ queryKey: ["monitors"], queryFn: () => api<Monitor[]>("/api/monitors"), refetchInterval: 5000 });
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [deleting, setDeleting] = useState<Monitor | null>(null);
  const { toggle, remove } = useMonitorActions();
  const togglingID = toggle.isPending ? toggle.variables?.id : undefined;

  const columns = useMemo<ColumnDef<Monitor>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Monitor",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.name}</span>
            {row.original.public_enabled ? (
              <span title={row.original.public_protected ? "Public page, password protected" : "Public page"} className="text-muted-foreground">
                {row.original.public_protected ? <LockIcon className="size-3" /> : <GlobeIcon className="size-3" />}
              </span>
            ) : null}
          </div>
        ),
      },
      { accessorKey: "target_url", header: "URL", cell: ({ row }) => <span className="font-mono text-xs">{row.original.target_url}</span> },
      {
        id: "status",
        header: "Status",
        accessorFn: (row) => (row.enabled ? row.last_status : "paused"),
        cell: ({ row }) => (row.original.enabled ? <StatusPill status={row.original.last_status} /> : <StatusPill status="unknown" label="paused" />),
      },
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
      {
        id: "actions",
        header: "",
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => (
          <MonitorRowActions
            monitor={row.original}
            pausing={togglingID === row.original.id}
            onToggle={() => toggle.mutate(row.original)}
            onEdit={() => setEditing(row.original)}
            onDelete={() => setDeleting(row.original)}
          />
        ),
      },
    ],
    [toggle, togglingID],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Checks</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Monitors</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImporting(true)}>
            Import
          </Button>
          <Button onClick={() => setCreating(true)}>Add website</Button>
        </div>
      </div>
      <DataTable
        columns={columns}
        data={monitors.data ?? []}
        searchPlaceholder="Search monitors"
        onRowClick={(monitor) => router.push(`/monitors/${monitor.id}`)}
        empty="Add a URL to start checking it from your nodes."
      />
      <ImportMonitorsDialog
        open={importing}
        onOpenChange={setImporting}
        onImported={() => {
          void client.invalidateQueries({ queryKey: ["monitors"] });
          void client.invalidateQueries({ queryKey: ["overview"] });
        }}
      />
      <MonitorDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(monitor) => {
          void client.invalidateQueries({ queryKey: ["monitors"] });
          router.push(`/monitors/${monitor.id}`);
        }}
      />
      <MonitorDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        monitor={editing}
        onSaved={(monitor) => {
          void client.invalidateQueries({ queryKey: ["monitors"] });
          void client.invalidateQueries({ queryKey: ["monitor", monitor.id] });
        }}
      />
      <DeleteMonitorDialog
        monitor={deleting}
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={(monitor) => remove.mutate(monitor, { onSuccess: () => setDeleting(null) })}
      />
    </div>
  );
}
