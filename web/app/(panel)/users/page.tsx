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
  const [selected, setSelected] = useState<UserRow | null>(null);
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
      <DataTable columns={columns} data={users.data ?? []} searchPlaceholder="Search users" onRowClick={setSelected} empty="No users yet." />
      <CreateUser open={open} onOpenChange={setOpen} onCreated={() => client.invalidateQueries({ queryKey: ["users"] })} />
      <EditUser
        user={selected}
        onClose={() => setSelected(null)}
        onSaved={() => {
          client.invalidateQueries({ queryKey: ["users"] });
          setSelected(null);
        }}
      />
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
              <Label key={group.id} className="font-normal">
                <Checkbox
                  checked={groupIDs.includes(group.id)}
                  onCheckedChange={(checked) =>
                    setGroupIDs((current) => (checked ? [...current, group.id] : current.filter((id) => id !== group.id)))
                  }
                />
                {group.name}
              </Label>
            ))}
          </div>
          <DialogFooter><Button type="submit" disabled={save.isPending}>Create</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUser({ user, onClose, onSaved }: { user: UserRow | null; onClose: () => void; onSaved: () => void }) {
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<Group[]>("/api/groups"), enabled: Boolean(user) });
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [groupIDs, setGroupIDs] = useState<string[]>([]);
  const [seen, setSeen] = useState<string | null>(null);
  if (user && seen !== user.id) {
    setSeen(user.id);
    setPassword("");
    setRole(user.role);
    setGroupIDs(user.groups.map((group) => group.id));
  }
  const save = useMutation({
    mutationFn: () => {
      const body: { password?: string; role: string; group_ids: string[] } = { role, group_ids: groupIDs };
      if (password) body.password = password;
      return api(`/api/users/${user?.id}`, { method: "PATCH", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast.success("User updated");
      onSaved();
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not update user"),
  });
  return (
    <Dialog open={Boolean(user)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit user</DialogTitle></DialogHeader>
        {user ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={user.email} disabled />
            </div>
            <div className="space-y-1.5">
              <Label>New password</Label>
              <Input
                type="password"
                minLength={8}
                value={password}
                placeholder="Leave blank to keep the current password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
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
              <Label>Groups</Label>
              {(groups.data ?? []).map((group) => (
                <Label key={group.id} className="font-normal">
                  <Checkbox
                    checked={groupIDs.includes(group.id)}
                    onCheckedChange={(checked) =>
                      setGroupIDs((current) => (checked ? [...current, group.id] : current.filter((id) => id !== group.id)))
                    }
                  />
                  {group.name}
                  <span className="text-xs text-muted-foreground">{group.visibility}</span>
                </Label>
              ))}
            </div>
            <DialogFooter><Button type="submit" disabled={save.isPending}>Save</Button></DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
