"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, LockIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";

import { FolderBadge, FolderGlyph } from "@/components/folder-ui";
import { StatusPill } from "@/components/status-pill";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { copyText, groupShareURL } from "@/lib/clipboard";
import { FOLDER_COLORS, FOLDER_ICONS, colorNames, iconNames, useRefreshMonitors } from "@/lib/folders";
import type { FolderColor, FolderIcon, Monitor, MonitorFolder } from "@/lib/types";

export type FolderTab = "details" | "monitors" | "sharing";

export function FolderDialog({
  open,
  onOpenChange,
  folder,
  folders,
  monitors,
  ownerId,
  initialTab = "details",
  initialMemberIds,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder?: MonitorFolder | null;
  folders: MonitorFolder[];
  monitors: Monitor[];
  ownerId?: string;
  initialTab?: FolderTab;
  initialMemberIds?: string[];
  onSaved?: (folder: MonitorFolder) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        {open ? (
          <FolderForm
            key={folder?.id ?? "new"}
            folder={folder ?? null}
            folders={folders}
            monitors={monitors}
            ownerId={folder?.owner_id ?? ownerId}
            initialTab={initialTab}
            initialMemberIds={initialMemberIds}
            onSaved={onSaved}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type PasswordMode = "keep" | "set" | "clear";

function FolderForm({
  folder,
  folders,
  monitors,
  ownerId,
  initialTab,
  initialMemberIds,
  onSaved,
  onClose,
}: {
  folder: MonitorFolder | null;
  folders: MonitorFolder[];
  monitors: Monitor[];
  ownerId?: string;
  initialTab: FolderTab;
  initialMemberIds?: string[];
  onSaved?: (folder: MonitorFolder) => void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const refresh = useRefreshMonitors();
  const editing = Boolean(folder);
  const eligible = useMemo(() => monitors.filter((monitor) => !ownerId || !monitor.owner_id || monitor.owner_id === ownerId), [monitors, ownerId]);
  const [startMembers] = useState(
    () => initialMemberIds ?? (folder ? eligible.filter((monitor) => monitor.folder_id === folder.id).map((monitor) => monitor.id) : []),
  );
  const [tab, setTab] = useState<FolderTab>(initialTab);
  const [name, setName] = useState(folder?.name ?? "");
  const [description, setDescription] = useState(folder?.description ?? "");
  const [color, setColor] = useState<FolderColor>(folder?.color ?? colorNames[(folders.length + 4) % colorNames.length]);
  const [icon, setIcon] = useState<FolderIcon>(folder?.icon ?? "folder");
  const [members, setMembers] = useState<string[]>(startMembers);
  const [share, setShare] = useState(folder?.public_enabled ?? false);
  const protectedNow = folder?.public_protected ?? false;
  const [passwordMode, setPasswordMode] = useState<PasswordMode>(protectedNow ? "keep" : "set");
  const [password, setPassword] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { name, description, color, icon, public_enabled: share, monitor_ids: members };
      if (passwordMode === "clear") payload.public_password = "";
      if (passwordMode === "set" && password) payload.public_password = password;
      if (passwordMode === "set" && !password && editing && protectedNow) payload.public_password = "";
      return editing
        ? api<MonitorFolder>(`/api/monitor-folders/${folder?.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : api<MonitorFolder>("/api/monitor-folders", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: (saved) => {
      toast.success(editing ? `Group “${saved.name}” saved` : `Group “${saved.name}” created`);
      refresh();
      onClose();
      onSaved?.(saved);
    },
    onError: (error) => {
      toast.error(errorMessage(error, "Could not save group"));
      if (!name.trim()) setTab("details");
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/monitor-folders/${folder?.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`Group “${folder?.name}” deleted. Its monitors are now ungrouped.`);
      client.setQueryData<MonitorFolder[]>(["monitor-folders"], (list) => list?.filter((item) => item.id !== folder?.id));
      refresh();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error, "Could not delete group")),
  });

  const link = folder?.public_slug ? groupShareURL(folder.public_slug) : null;
  const preview = { name: name.trim() || "Untitled group", color, icon };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2.5">
          <FolderGlyph color={color} icon={icon} />
          {editing ? `Edit ${folder?.name}` : "New group"}
        </DialogTitle>
        <DialogDescription>Groups keep related monitors together, roll up their health, and can share one status page.</DialogDescription>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Tabs value={tab} onValueChange={(value) => setTab(value as FolderTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="monitors">
              Monitors
              <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[10px] tabular-nums">{members.length}</span>
            </TabsTrigger>
            <TabsTrigger value="sharing">Status page</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Production, Client A, Marketing sites…" maxLength={80} required />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {colorNames.map((option) => (
                  <button
                    key={option}
                    type="button"
                    title={option}
                    aria-label={option}
                    aria-pressed={color === option}
                    onClick={() => setColor(option)}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110",
                      FOLDER_COLORS[option].dot,
                      color === option && cn("ring-2", FOLDER_COLORS[option].ring),
                    )}
                  >
                    {color === option ? <CheckIcon className="size-3.5 text-white" /> : null}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Icon</Label>
              <div className="flex flex-wrap gap-1.5">
                {iconNames.map((option) => {
                  const Icon = FOLDER_ICONS[option];
                  const active = icon === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      title={option}
                      aria-label={option}
                      aria-pressed={active}
                      onClick={() => setIcon(option)}
                      className={cn(
                        "flex size-9 items-center justify-center rounded-lg border transition-colors",
                        active ? cn("border-transparent", FOLDER_COLORS[color].soft) : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={280} rows={2} placeholder="Shown on the group's status page" />
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-dashed p-3">
              <FolderGlyph color={preview.color} icon={preview.icon} size="lg" />
              <div className="min-w-0">
                <p className="truncate font-medium">{preview.name}</p>
                <p className="text-xs text-muted-foreground">
                  {members.length} monitor{members.length === 1 ? "" : "s"}
                  {description.trim() ? ` · ${description.trim()}` : ""}
                </p>
              </div>
              <FolderBadge folder={preview} className="ml-auto" />
            </div>
          </TabsContent>

          <TabsContent value="monitors" className="pt-2">
            <MemberPicker monitors={eligible} folders={folders} folderId={folder?.id ?? null} startMembers={startMembers} selected={members} onChange={setMembers} />
          </TabsContent>

          <TabsContent value="sharing" className="space-y-3 pt-2">
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Public group status page</Label>
                  <p className="text-xs text-muted-foreground">One page with uptime bars for every monitor in this group.</p>
                </div>
                <Switch checked={share} onCheckedChange={setShare} />
              </div>
              {share && link && folder?.public_enabled ? (
                <div className="flex items-center gap-2">
                  <Input readOnly value={link} className="font-mono text-xs" onFocus={(event) => event.target.select()} />
                  <Button type="button" variant="outline" size="icon" title="Copy link" onClick={() => copyText(link, "Link copied")}>
                    <CopyIcon />
                  </Button>
                </div>
              ) : null}
              {share && !folder?.public_enabled ? <p className="text-xs text-muted-foreground">The link is generated when you save.</p> : null}
              {share ? (
                <div className="space-y-2">
                  {protectedNow && passwordMode === "keep" ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        <LockIcon className="size-3.5" />
                        Password protected
                      </span>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setPasswordMode("set")}>
                          Change password
                        </Button>
                        <Button type="button" variant="destructive" size="sm" onClick={() => setPasswordMode("clear")}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {passwordMode === "clear" ? (
                    <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                      <span>The password will be removed on save.</span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setPasswordMode("keep")}>
                        Undo
                      </Button>
                    </div>
                  ) : null}
                  {passwordMode === "set" ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label>{protectedNow ? "New password" : "Password (optional)"}</Label>
                        {protectedNow ? (
                          <Button type="button" variant="ghost" size="xs" onClick={() => setPasswordMode("keep")}>
                            Keep current
                          </Button>
                        ) : null}
                      </div>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        minLength={password ? 4 : undefined}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder={protectedNow ? "Leave empty to remove the password" : "Leave empty for an open page"}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="items-center sm:justify-between">
          {editing ? (
            <Button type="button" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2Icon />
              Delete group
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {editing ? "Save group" : members.length ? `Create with ${members.length} monitor${members.length === 1 ? "" : "s"}` : "Create group"}
            </Button>
          </div>
        </DialogFooter>
      </form>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {folder?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The {folder?.monitor_count ?? 0} monitor{folder?.monitor_count === 1 ? "" : "s"} inside keep running and move to Ungrouped.
              {folder?.public_enabled ? " The group status page stops working." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Delete group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MemberPicker({
  monitors,
  folders,
  folderId,
  startMembers,
  selected,
  onChange,
}: {
  monitors: Monitor[];
  folders: MonitorFolder[];
  folderId: string | null;
  startMembers: string[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "selected" | "ungrouped">("all");
  const byId = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const ordered = useMemo(() => {
    const start = new Set(startMembers);
    return [...monitors].sort((a, b) => Number(start.has(b.id)) - Number(start.has(a.id)) || a.name.localeCompare(b.name));
  }, [monitors, startMembers]);
  const chosen = new Set(selected);
  const term = query.trim().toLowerCase();
  const visible = ordered.filter((monitor) => {
    if (scope === "selected" && !chosen.has(monitor.id)) return false;
    if (scope === "ungrouped" && monitor.folder_id) return false;
    return !term || monitor.name.toLowerCase().includes(term) || monitor.target_url.toLowerCase().includes(term);
  });
  const allVisibleChosen = visible.length > 0 && visible.every((monitor) => chosen.has(monitor.id));
  const someVisibleChosen = visible.some((monitor) => chosen.has(monitor.id));
  const moving = selected.filter((id) => {
    const monitor = monitors.find((item) => item.id === id);
    return monitor?.folder_id && monitor.folder_id !== folderId;
  }).length;
  const leaving = startMembers.filter((id) => !chosen.has(id)).length;

  const toggle = (id: string, on: boolean) => onChange(on ? [...selected, id] : selected.filter((item) => item !== id));
  const toggleVisible = (on: boolean) => {
    const ids = new Set(visible.map((monitor) => monitor.id));
    onChange(on ? Array.from(new Set([...selected, ...ids])) : selected.filter((id) => !ids.has(id)));
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or URL" className="pl-8" />
        </div>
        <div className="flex rounded-lg bg-muted p-[3px] text-xs">
          {(["all", "selected", "ungrouped"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setScope(option)}
              className={cn("rounded-md px-2 py-1 capitalize transition-colors", scope === option ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {option === "selected" ? `In group (${selected.length})` : option}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <label className="flex cursor-pointer items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Checkbox
            checked={allVisibleChosen}
            indeterminate={!allVisibleChosen && someVisibleChosen}
            disabled={visible.length === 0}
            onCheckedChange={(checked) => toggleVisible(checked === true)}
          />
          <span className="flex-1">{allVisibleChosen ? "Deselect" : "Select"} {term || scope !== "all" ? "shown" : "all"} ({visible.length})</span>
          <span className="tabular-nums">{selected.length} selected</span>
        </label>
        <div className="max-h-80 overflow-y-auto">
          {monitors.length === 0 ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">No monitors yet. You can add them to this group later.</p> : null}
          {monitors.length > 0 && visible.length === 0 ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing matches.</p> : null}
          {visible.map((monitor) => {
            const current = monitor.folder_id ? byId.get(monitor.folder_id) : undefined;
            const elsewhere = current && current.id !== folderId;
            const on = chosen.has(monitor.id);
            return (
              <label
                key={monitor.id}
                className={cn("flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0 transition-colors", on ? "bg-primary/4" : "hover:bg-muted/50")}
              >
                <Checkbox checked={on} onCheckedChange={(checked) => toggle(monitor.id, checked === true)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{monitor.name}</span>
                    {monitor.enabled ? <StatusPill status={monitor.last_status} /> : <StatusPill status="unknown" label="paused" />}
                  </div>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{monitor.target_url}</p>
                </div>
                {elsewhere ? (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                    {on ? "moves from" : "in"}
                    <FolderBadge folder={current} />
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      </div>
      {moving > 0 || leaving > 0 ? (
        <p className="text-xs text-muted-foreground">
          {moving > 0 ? `${moving} monitor${moving === 1 ? "" : "s"} will move here from another group. ` : ""}
          {leaving > 0 ? `${leaving} monitor${leaving === 1 ? "" : "s"} will become ungrouped.` : ""}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">A monitor lives in one group at a time. Picking one from another group moves it here.</p>
      )}
    </div>
  );
}
