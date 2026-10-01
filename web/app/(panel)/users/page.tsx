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
import { ApiError, api } from "@/lib/api";
import type { Group, UserRow } from "@/lib/types";

export default function UsersPage() {
  const client = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<UserRow[]>("/api/users") });
  const [open, setOpen] = useState(false);
  const columns = useMemo<ColumnDef<UserRow>[]>(
    () => [
      { accessorKey: "email", header: "Email" },
      { accessorKey: "role", header: "Role", cell: ({ row }) => <Badge variant="secondary">{row.original.role}</Badge> },
      {
        id: "groups",
        header: "Groups",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.groups.map((group) => <Badge key={group.id} variant="outline">{group.name}</Badge>)}
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
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Access</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Users</h1>
        </div>
        <Button onClick={() => setOpen(true)}>Add user</Button>
      </div>
      <DataTable columns={columns} data={users.data ?? []} searchPlaceholder="Search users" empty="No users yet." />
      <CreateUser open={open} onOpenChange={setOpen} onCreated={() => client.invalidateQueries({ queryKey: ["users"] })} />
    </div>
  );
}

function CreateUser({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<Group[]>("/api/groups"), enabled: open });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [groupIDs, setGroupIDs] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: () => api("/api/users", { method: "POST", body: JSON.stringify({ email, password, role, group_ids: groupIDs }) }),
    onSuccess: () => {
      toast.success("User created");
      setEmail("");
      setPassword("");
      setGroupIDs([]);
      onOpenChange(false);
      onCreated();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not create user"),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add user</DialogTitle></DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
          <div className="space-y-1.5"><Label>Password</Label><Input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(value) => value && setRole(value)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Private groups</Label>
            {(groups.data ?? []).filter((group) => group.visibility === "private").map((group) => (
              <label key={group.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={groupIDs.includes(group.id)}
                  onCheckedChange={(checked) =>
                    setGroupIDs((current) => (checked ? [...current, group.id] : current.filter((id) => id !== group.id)))
                  }
                />
                {group.name}
              </label>
            ))}
          </div>
          <DialogFooter><Button type="submit" disabled={save.isPending}>Create</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
