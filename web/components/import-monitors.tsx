"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { GroupChecks } from "@/components/group-checks";
import { LinkListField } from "@/components/link-list-field";
import { PresetSelect } from "@/components/preset-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { formatInterval, intervalStops } from "@/lib/format";
import type { PublicConfig } from "@/lib/types";

export function ImportMonitorsDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const config = useQuery({ queryKey: ["config"], queryFn: () => api<PublicConfig>("/api/config") });
  const stops = intervalStops(config.data?.min_interval_sec ?? 30);
  const [text, setText] = useState("");
  const [groupIDs, setGroupIDs] = useState<string[]>([]);
  const [preset, setPreset] = useState("default");
  const [interval, setIntervalSec] = useState(60);
  const [enabled, setEnabled] = useState(true);
  const intervalSec = stops.includes(interval) ? interval : (stops[0] ?? interval);

  const save = useMutation({
    mutationFn: () =>
      api<{ created: number }>("/api/monitors/import", {
        method: "POST",
        body: JSON.stringify({
          text,
          group_ids: groupIDs,
          interval_sec: intervalSec,
          enabled,
          template_id: preset === "default" ? "" : preset,
          max_nodes: 20,
        }),
      }),
    onSuccess: (result) => {
      toast.success(`Imported ${result.created} monitor${result.created === 1 ? "" : "s"}`);
      setText("");
      onOpenChange(false);
      onImported();
    },
    onError: (error) => toast.error(errorMessage(error, "Could not import monitors")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import monitors</DialogTitle>
          <DialogDescription>Each link becomes a monitor with the shared pool, interval, and preset.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label>Links</Label>
            <LinkListField
              value={text}
              onChange={setText}
              placeholder={"https://example.com\nBilling https://billing.example.com/health\n# comments are ignored"}
            />
            <p className="text-xs text-muted-foreground">One link per line, or upload a .txt file. Put a name before a link to name that monitor.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Interval</Label>
            <Select value={String(intervalSec)} onValueChange={(value) => value && setIntervalSec(Number(value))}>
              <SelectTrigger className="w-full">
                <SelectValue>{(current) => formatInterval(Number(current) || intervalSec)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {stops.map((stop) => (
                  <SelectItem key={stop} value={String(stop)}>
                    {formatInterval(stop)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <GroupChecks ids={groupIDs} onChange={setGroupIDs} />
          <PresetSelect value={preset} onChange={setPreset} />
          {preset !== "default" ? <p className="text-xs text-muted-foreground">Each monitor keeps a copy of this preset.</p> : null}
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Checks running</Label>
              <p className="text-xs text-muted-foreground">Turn off to import them paused.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending || !text.trim() || groupIDs.length === 0}>
              Import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
