"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LinkIcon, LockIcon, PauseIcon, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react";
import type { MouseEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api, errorMessage } from "@/lib/api";
import { copyText, shareURL } from "@/lib/clipboard";
import type { Monitor } from "@/lib/types";

export function useMonitorActions() {
  const client = useQueryClient();
  const refresh = (id: string) => {
    void client.invalidateQueries({ queryKey: ["monitors"] });
    void client.invalidateQueries({ queryKey: ["monitor", id] });
    void client.invalidateQueries({ queryKey: ["overview"] });
  };
  const toggle = useMutation({
    mutationFn: (monitor: Monitor) =>
      api<Monitor>(`/api/monitors/${monitor.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !monitor.enabled }) }),
    onSuccess: (saved) => {
      toast.success(saved.enabled ? `${saved.name} resumed` : `${saved.name} paused`);
      refresh(saved.id);
    },
    onError: (error) => toast.error(errorMessage(error, "Could not update monitor")),
  });
  const remove = useMutation({
    mutationFn: (monitor: Monitor) => api(`/api/monitors/${monitor.id}`, { method: "DELETE" }),
    onSuccess: (_data, monitor) => {
      toast.success(`${monitor.name} deleted`);
      client.removeQueries({ queryKey: ["monitor", monitor.id] });
      void client.invalidateQueries({ queryKey: ["monitors"] });
      void client.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not delete monitor")),
  });
  return { toggle, remove };
}

export function copyShare(monitor: Monitor) {
  if (!monitor.public_enabled || !monitor.public_slug) return;
  void copyText(shareURL(monitor.public_slug), monitor.public_protected ? "Link copied (password protected)" : "Link copied");
}

const stop = (handler: () => void) => (event: MouseEvent) => {
  event.stopPropagation();
  handler();
};

export function MonitorRowActions({
  monitor,
  pausing,
  onToggle,
  onEdit,
  onDelete,
}: {
  monitor: Monitor;
  pausing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const shared = monitor.public_enabled && Boolean(monitor.public_slug);
  return (
    <div className="flex items-center justify-end gap-0.5" onClick={(event) => event.stopPropagation()}>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!shared}
        title={shared ? (monitor.public_protected ? "Copy status page link (password protected)" : "Copy status page link") : "Status page is off"}
        onClick={stop(() => copyShare(monitor))}
        className="relative"
      >
        <LinkIcon />
        {shared && monitor.public_protected ? <LockIcon className="absolute right-0.5 bottom-0.5 size-2.5!" /> : null}
      </Button>
      <Button variant="ghost" size="icon-sm" disabled={pausing} title={monitor.enabled ? "Pause checks" : "Resume checks"} onClick={stop(onToggle)}>
        {monitor.enabled ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <Button variant="ghost" size="icon-sm" title="Edit" onClick={stop(onEdit)}>
        <PencilIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" title="Delete" className="text-muted-foreground hover:text-destructive" onClick={stop(onDelete)}>
        <Trash2Icon />
      </Button>
    </div>
  );
}

export function DeleteMonitorDialog({
  monitor,
  pending,
  onCancel,
  onConfirm,
}: {
  monitor: Monitor | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (monitor: Monitor) => void;
}) {
  return (
    <AlertDialog open={Boolean(monitor)} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {monitor?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            All check history is removed{monitor?.public_enabled ? " and the public status page stops working" : ""}. Pause the monitor instead if you only want to stop checks.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={() => monitor && onConfirm(monitor)}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
