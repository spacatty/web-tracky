"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import type { FleetNode, Group, Me, UserRow } from "@/lib/types";

export default function GroupsPage() {
  const client = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/auth/me") });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<Group[]>("/api/groups") });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const admin = me.data?.role === "admin";
  const columns = useMemo<ColumnDef<Group>[]>(
    () => [
      { accessorKey: "name", header: "Group" },
      {
        accessorKey: "visibility",
        header: "Visibility",
        cell: ({ row }) => <Badge variant={row.original.visibility === "public" ? "default" : "secondary"}>{row.original.visibility}</Badge>,
      },
      { accessorKey: "node_count", header: "Nodes" },
      { accessorKey: "user_count", header: "Users" },
      { accessorKey: "description", header: "Notes", cell: ({ row }) => <span className="text-muted-foreground">{row.original.description}</span> },
    ],
    [],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Pools</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Groups</h1>
        </div>
        {admin ? <Button onClick={() => setOpen(true)}>New group</Button> : null}
      </div>
      <DataTable columns={columns} data={groups.data ?? []} searchPlaceholder="Search groups" onRowClick={(group) => setSelected(group.id)} empty="No groups yet." />
      <CreateGroup open={open} onOpenChange={setOpen} onCreated={() => client.invalidateQueries({ queryKey: ["groups"] })} />
      <GroupSheet id={selected} admin={admin} onClose={() => setSelected(null)} />
    </div>
  );
}

function CreateGroup({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [description, setDescription] = useState("");
  const save = useMutation({
    mutationFn: () => api("/api/groups", { method: "POST", body: JSON.stringify({ name, visibility, description, user_ids: [], node_ids: [] }) }),
    onSuccess: () => {
      toast.success("Group created");
      setName("");
      setDescription("");
      onOpenChange(false);
      onCreated();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not create group"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
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
            <Label>Visibility</Label>
            <Select value={visibility} onValueChange={(value) => value && setVisibility(value)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public — every user can check from these nodes</SelectItem>
                <SelectItem value="private">Private — members only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GroupSheet({ id, admin, onClose }: { id: string | null; admin: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const group = useQuery({ queryKey: ["group", id], queryFn: () => api<Group>(`/api/groups/${id}`), enabled: Boolean(id) });
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<UserRow[]>("/api/users"), enabled: admin && Boolean(id) });
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: () => api<FleetNode[]>("/api/nodes"), enabled: admin && Boolean(id) });
  const [userIDs, setUserIDs] = useState<string[]>([]);
  const [nodeIDs, setNodeIDs] = useState<string[]>([]);
  const [seen, setSeen] = useState<string | null>(null);
  if (group.data && seen !== group.data.id) {
    setSeen(group.data.id);
    setUserIDs((group.data.users ?? []).map((user) => user.id));
    setNodeIDs((group.data.nodes ?? []).map((node) => node.id));
  }
  const save = useMutation({
    mutationFn: () => api(`/api/groups/${id}`, { method: "PATCH", body: JSON.stringify({ user_ids: userIDs, node_ids: nodeIDs }) }),
    onSuccess: () => {
      toast.success("Group updated");
      client.invalidateQueries({ queryKey: ["groups"] });
      client.invalidateQueries({ queryKey: ["group", id] });
      client.invalidateQueries({ queryKey: ["nodes"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not save"),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/groups/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Group deleted");
      onClose();
      client.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not delete"),
  });

  return (
    <Sheet open={Boolean(id)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{group.data?.name ?? "Group"}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <p className="text-sm text-muted-foreground">{group.data?.description}</p>
          {(group.data?.nodes ?? []).map((node) => (
            <div key={node.id} className="text-sm">{node.name}</div>
          ))}
          {admin ? (
            <div className="space-y-4">
              <CheckList
                title="Users"
                items={(users.data ?? []).map((user) => ({ id: user.id, label: user.email }))}
                selected={userIDs}
                onChange={setUserIDs}
              />
              <CheckList
                title="Nodes"
                items={(nodes.data ?? []).map((node) => ({ id: node.id, label: node.name }))}
                selected={nodeIDs}
                onChange={setNodeIDs}
              />
              <div className="flex gap-2">
                <Button onClick={() => save.mutate()} disabled={save.isPending}>Save membership</Button>
                <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>Delete</Button>
              </div>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CheckList({
  title,
  items,
  selected,
  onChange,
}: {
  title: string;
  items: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{title}</Label>
      <div className="max-h-40 space-y-1.5 overflow-auto rounded-lg border p-2">
        {items.length === 0 ? <p className="text-xs text-muted-foreground">None yet.</p> : null}
        {items.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected.includes(item.id)}
              onCheckedChange={(checked) =>
                onChange(checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))
              }
            />
            {item.label}
          </label>
        ))}
      </div>
    </div>
  );
}
