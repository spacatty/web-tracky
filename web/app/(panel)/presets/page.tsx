"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { SuccessRulesField } from "@/components/success-rules";
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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { formatAgo } from "@/lib/format";
import { compileRules, describeSuccess, toDraft, type DraftRule } from "@/lib/success";
import type { StatusTemplate } from "@/lib/types";

export default function PresetsPage() {
  const client = useQueryClient();
  const templates = useQuery({ queryKey: ["status-templates"], queryFn: () => api<StatusTemplate[]>("/api/status-templates") });
  const [editing, setEditing] = useState<StatusTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<StatusTemplate | null>(null);

  const remove = useMutation({
    mutationFn: (template: StatusTemplate) => api(`/api/status-templates/${template.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Preset deleted");
      setDeleting(null);
      void client.invalidateQueries({ queryKey: ["status-templates"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not delete preset")),
  });

  const columns = useMemo<ColumnDef<StatusTemplate>[]>(
    () => [
      { accessorKey: "name", header: "Preset", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      {
        id: "rules",
        header: "Match",
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{describeSuccess(row.original.success_rules)}</span>,
      },
      { id: "created", header: "Added", cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatAgo(row.original.created_at)}</span> },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-0.5" onClick={(event) => event.stopPropagation()}>
            <Button variant="ghost" size="icon-sm" title="Edit" onClick={() => setEditing(row.original)}>
              <PencilIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" title="Delete" onClick={() => setDeleting(row.original)}>
              <Trash2Icon />
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Checks</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Status presets</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Named success rules you can apply to a monitor, an import, or a one-off check. A preset such as Some Service can pass only on HTTP 404 when the body contains a fixed phrase.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>New preset</Button>
      </div>
      <DataTable
        columns={columns}
        data={templates.data ?? []}
        searchPlaceholder="Search presets"
        onRowClick={(template) => setEditing(template)}
        empty="Add a preset when a check should pass on a specific status or response text."
      />
      <PresetDialog
        open={creating || Boolean(editing)}
        template={creating ? null : editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        onSaved={() => {
          void client.invalidateQueries({ queryKey: ["status-templates"] });
          setCreating(false);
          setEditing(null);
        }}
      />
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Monitors that already use this preset keep the rules they copied.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PresetDialog({
  open,
  template,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  template: StatusTemplate | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
        {open ? <PresetForm key={template?.id ?? "new"} template={template} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PresetForm({ template, onSaved }: { template: StatusTemplate | null; onSaved: () => void }) {
  const draft = toDraft(template?.success_rules);
  const [name, setName] = useState(template?.name ?? "");
  const [rules, setRules] = useState<DraftRule[]>(draft.enabled ? draft.rules : [{ status: "", body: "contains", text: "", join: "or" }]);
  const save = useMutation({
    mutationFn: () => {
      const compiled = compileRules(true, rules);
      if (!compiled.ok) return Promise.reject(new Error(compiled.error));
      const payload = { name, success_rules: compiled.rules };
      return template
        ? api<StatusTemplate>(`/api/status-templates/${template.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : api<StatusTemplate>("/api/status-templates", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      toast.success(template ? "Preset updated" : "Preset created");
      onSaved();
    },
    onError: (error) => toast.error(errorMessage(error, template ? "Could not save preset" : "Could not create preset")),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{template ? "Edit preset" : "New preset"}</DialogTitle>
        <DialogDescription>Monitors keep a copy from the moment you select the preset.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label>Name</Label>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Some Service" required />
      </div>
      <SuccessRulesField required enabled label="Match" rules={rules} onEnabledChange={() => undefined} onChange={setRules} />
      <DialogFooter>
        <Button type="submit" disabled={save.isPending}>
          {template ? "Save changes" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}
