"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ExternalLinkIcon,
  FolderInputIcon,
  FolderMinusIcon,
  FolderPlusIcon,
  GlobeIcon,
  GripVerticalIcon,
  LinkIcon,
  ListPlusIcon,
  LockIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "cn";

import { FolderDialog, type FolderTab } from "@/components/folder-dialog";
import { FolderGlyph } from "@/components/folder-ui";
import { ImportMonitorsDialog } from "@/components/import-monitors";
import { DeleteMonitorDialog, MonitorRowActions, useMonitorActions } from "@/components/monitor-actions";
import { MonitorDialog } from "@/components/monitor-form";
import { StatusDot } from "@/components/status-pill";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { copyText, groupShareURL } from "@/lib/clipboard";
import { FOLDER_COLORS, folderStats, useBulkMonitors, useFolders, type FolderStats } from "@/lib/folders";
import { formatAgo, formatInterval, formatUptime } from "@/lib/format";
import type { Me, Monitor, MonitorFolder } from "@/lib/types";

const UNGROUPED = "none";
const COLLAPSE_KEY = "tracky-collapsed-groups";
const DRAG_TYPE = "application/x-tracky-monitors";

type StatusFilter = "all" | "fail" | "paused";
type FolderDialogState = { folder: MonitorFolder | null; tab: FolderTab; members?: string[] } | null;

const ROW_GRID =
  "grid grid-cols-[28px_minmax(0,1fr)_auto] md:grid-cols-[28px_minmax(0,1fr)_68px_52px_76px_auto] lg:grid-cols-[28px_minmax(0,1fr)_68px_52px_minmax(0,128px)_76px_auto] items-center gap-x-3";

export default function MonitorsPage() {
  const router = useRouter();
  const client = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/auth/me") });
  const monitors = useQuery({ queryKey: ["monitors"], queryFn: () => api<Monitor[]>("/api/monitors"), refetchInterval: 5000 });
  const folders = useFolders();
  const bulk = useBulkMonitors();
  const { toggle, remove } = useMonitorActions();
  const togglingID = toggle.isPending ? toggle.variables?.id : undefined;

  const [creating, setCreating] = useState<{ folderId?: string } | null>(null);
  const [importing, setImporting] = useState<{ folderId?: string } | null>(null);
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [deleting, setDeleting] = useState<Monitor | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialogState>(null);
  const [deletingFolder, setDeletingFolder] = useState<MonitorFolder | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [scope, setScope] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    let stored: string[] = [];
    try {
      stored = JSON.parse(window.localStorage.getItem(COLLAPSE_KEY) ?? "[]") as string[];
    } catch {}
    const linked = window.location.hash.startsWith("#group-") ? window.location.hash.slice("#group-".length) : null;
    return new Set(stored.filter((key) => key !== linked));
  });
  const [dragging, setDragging] = useState<string[] | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const ghost = useRef<HTMLDivElement>(null);

  const allMonitors = useMemo(() => monitors.data ?? [], [monitors.data]);
  const allFolders = useMemo(() => folders.data ?? [], [folders.data]);
  const folderById = useMemo(() => new Map(allFolders.map((folder) => [folder.id, folder])), [allFolders]);
  const monitorById = useMemo(() => new Map(allMonitors.map((monitor) => [monitor.id, monitor])), [allMonitors]);
  const selectedIds = useMemo(() => [...selected].filter((id) => monitorById.has(id)), [selected, monitorById]);
  const keyOf = (monitor: Monitor) => (monitor.folder_id && folderById.has(monitor.folder_id) ? monitor.folder_id : UNGROUPED);

  const term = query.trim().toLowerCase();
  const filtering = term !== "" || status !== "all";
  const matches = (monitor: Monitor) => {
    if (status === "fail" && !(monitor.enabled && monitor.last_status === "fail")) return false;
    if (status === "paused" && monitor.enabled) return false;
    return !term || monitor.name.toLowerCase().includes(term) || monitor.target_url.toLowerCase().includes(term);
  };

  const byKey = useMemo(() => {
    const map = new Map<string, Monitor[]>();
    for (const monitor of allMonitors) {
      const key = monitor.folder_id && folderById.has(monitor.folder_id) ? monitor.folder_id : UNGROUPED;
      map.set(key, [...(map.get(key) ?? []), monitor]);
    }
    return map;
  }, [allMonitors, folderById]);

  const sections = [
    ...allFolders.map((folder) => ({ key: folder.id, folder })),
    ...((byKey.get(UNGROUPED)?.length ?? 0) > 0 || allFolders.length === 0 ? [{ key: UNGROUPED, folder: null }] : []),
  ]
    .filter((section) => scope === "all" || scope === section.key)
    .map((section) => {
      const all = byKey.get(section.key) ?? [];
      return { ...section, all, shown: all.filter(matches) };
    })
    .filter((section) => !filtering || section.shown.length > 0);

  const failing = allMonitors.filter((monitor) => monitor.enabled && monitor.last_status === "fail").length;
  const paused = allMonitors.filter((monitor) => !monitor.enabled).length;

  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
  }, [collapsed]);

  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !folders.data || !monitors.data) return;
    scrolled.current = true;
    const hash = window.location.hash;
    if (!hash.startsWith("#group-")) return;
    const id = hash.slice("#group-".length);
    requestAnimationFrame(() => document.getElementById(`group-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [folders.data, monitors.data]);

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api("/api/monitor-folders/reorder", { method: "POST", body: JSON.stringify({ ids }) }),
    onMutate: (ids) => {
      const previous = client.getQueryData<MonitorFolder[]>(["monitor-folders"]);
      if (previous) {
        const rank = new Map(ids.map((id, i) => [id, i]));
        client.setQueryData(["monitor-folders"], [...previous].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)));
      }
      return { previous };
    },
    onError: (error, _ids, context) => {
      if (context?.previous) client.setQueryData(["monitor-folders"], context.previous);
      toast.error(errorMessage(error, "Could not reorder groups"));
    },
    onSettled: () => void client.invalidateQueries({ queryKey: ["monitor-folders"] }),
  });

  const removeFolder = useMutation({
    mutationFn: (folder: MonitorFolder) => api(`/api/monitor-folders/${folder.id}`, { method: "DELETE" }),
    onSuccess: (_data, folder) => {
      toast.success(`Group “${folder.name}” deleted. Its monitors are now ungrouped.`);
      setDeletingFolder(null);
      if (scope === folder.id) setScope("all");
      void client.invalidateQueries({ queryKey: ["monitor-folders"] });
      void client.invalidateQueries({ queryKey: ["monitors"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not delete group")),
  });

  const moveFolder = (folder: MonitorFolder, delta: number) => {
    const ids = allFolders.map((item) => item.id);
    const from = ids.indexOf(folder.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    reorder.mutate(ids);
  };

  const toggleCollapsed = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allCollapsed = sections.length > 0 && sections.every((section) => collapsed.has(section.key));

  const setMany = (ids: string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const moveTo = (ids: string[], key: string) => {
    const folder = key === UNGROUPED ? null : folderById.get(key);
    const pending = ids.filter((id) => {
      const monitor = monitorById.get(id);
      return monitor && keyOf(monitor) !== key;
    });
    if (pending.length === 0) return;
    bulk.mutate(
      { ids: pending, action: "move", folder_id: folder?.id, folderName: folder?.name },
      { onSuccess: () => setSelected(new Set()) },
    );
  };

  const onDragStart = (event: DragEvent, monitor: Monitor) => {
    const ids = selected.has(monitor.id) ? selectedIds : [monitor.id];
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    if (ghost.current) {
      ghost.current.textContent = ids.length === 1 ? `Move ${monitor.name}` : `Move ${ids.length} monitors`;
      event.dataTransfer.setDragImage(ghost.current, 16, 16);
    }
    setDragging(ids);
  };
  const onDragEnd = () => {
    setDragging(null);
    setDropTarget(null);
  };
  const dropProps = (key: string, target = key) => ({
    onDragOver: (event: DragEvent) => {
      if (!dragging) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dropTarget !== target) setDropTarget(target);
    },
    onDragLeave: (event: DragEvent) => {
      if (!(event.currentTarget as Node).contains(event.relatedTarget as Node | null)) setDropTarget((current) => (current === target ? null : current));
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData(DRAG_TYPE);
      onDragEnd();
      if (!raw) return;
      moveTo(JSON.parse(raw) as string[], key);
    },
  });

  const selectedOwners = new Set(selectedIds.map((id) => monitorById.get(id)?.owner_id ?? ""));
  const selectionOwner = selectedOwners.size === 1 ? [...selectedOwners][0] : null;
  const moveTargets = selectionOwner ? allFolders.filter((folder) => folder.owner_id === selectionOwner) : [];
  const selectedMonitors = selectedIds.map((id) => monitorById.get(id)).filter((monitor): monitor is Monitor => Boolean(monitor));
  const anyPaused = selectedMonitors.some((monitor) => !monitor.enabled);
  const anyRunning = selectedMonitors.some((monitor) => monitor.enabled);

  const loading = monitors.isLoading || folders.isLoading;
  const empty = !loading && allMonitors.length === 0 && allFolders.length === 0;

  return (
    <div className={cn("space-y-5", selectedIds.length > 0 && "pb-20")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Checks</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Monitors</h1>
          {allMonitors.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {allMonitors.length} monitor{allMonitors.length === 1 ? "" : "s"} in {allFolders.length} group{allFolders.length === 1 ? "" : "s"}
              {failing > 0 ? <span className="text-destructive"> · {failing} failing</span> : null}
              {paused > 0 ? ` · ${paused} paused` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setFolderDialog({ folder: null, tab: "details" })}>
            <FolderPlusIcon />
            New group
          </Button>
          <Button variant="outline" onClick={() => setImporting({ folderId: scope !== "all" && scope !== UNGROUPED ? scope : undefined })}>
            <UploadIcon />
            Import
          </Button>
          <Button onClick={() => setCreating({ folderId: scope !== "all" && scope !== UNGROUPED ? scope : undefined })}>
            <PlusIcon />
            Add website
          </Button>
        </div>
      </div>

      {empty ? (
        <EmptyState onCreate={() => setCreating({})} onImport={() => setImporting({})} onGroup={() => setFolderDialog({ folder: null, tab: "details" })} />
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full max-w-xs">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search monitors" className="bg-card pl-8" />
              </div>
              <Segmented
                value={status}
                onChange={setStatus}
                options={[
                  { value: "all", label: "All" },
                  { value: "fail", label: `Failing${failing ? ` · ${failing}` : ""}` },
                  { value: "paused", label: `Paused${paused ? ` · ${paused}` : ""}` },
                ]}
              />
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-muted-foreground"
                onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(sections.map((section) => section.key)))}
              >
                {allCollapsed ? <ChevronsUpDownIcon /> : <ChevronsDownUpIcon />}
                {allCollapsed ? "Expand all" : "Collapse all"}
              </Button>
            </div>
            {allFolders.length > 0 ? (
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                <Chip active={scope === "all"} onClick={() => setScope("all")}>
                  All
                  <Count>{allMonitors.length}</Count>
                </Chip>
                {allFolders.map((folder) => {
                  const list = byKey.get(folder.id) ?? [];
                  const failingHere = list.some((monitor) => monitor.enabled && monitor.last_status === "fail");
                  return (
                    <Chip
                      key={folder.id}
                      active={scope === folder.id}
                      dropping={dropTarget === `chip-${folder.id}`}
                      onClick={() => setScope(scope === folder.id ? "all" : folder.id)}
                      {...dropProps(folder.id, `chip-${folder.id}`)}
                    >
                      <span className={cn("size-2 rounded-full", FOLDER_COLORS[folder.color].dot)} />
                      <span className="max-w-40 truncate">{folder.name}</span>
                      <Count>{list.length}</Count>
                      {failingHere ? <span className="size-1.5 rounded-full bg-destructive" title="Something is failing" /> : null}
                    </Chip>
                  );
                })}
                {(byKey.get(UNGROUPED)?.length ?? 0) > 0 ? (
                  <Chip
                    active={scope === UNGROUPED}
                    dropping={dropTarget === `chip-${UNGROUPED}`}
                    onClick={() => setScope(scope === UNGROUPED ? "all" : UNGROUPED)}
                    {...dropProps(UNGROUPED, `chip-${UNGROUPED}`)}
                  >
                    <FolderMinusIcon className="size-3.5 text-muted-foreground" />
                    Ungrouped
                    <Count>{byKey.get(UNGROUPED)?.length ?? 0}</Count>
                  </Chip>
                ) : null}
                <button
                  type="button"
                  onClick={() => setFolderDialog({ folder: null, tab: "details" })}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  <PlusIcon className="size-3.5" />
                  Group
                </button>
              </div>
            ) : null}
          </div>

          <div className={cn(ROW_GRID, "hidden px-4 text-[11px] tracking-wide text-muted-foreground uppercase md:grid")}>
            <span />
            <span className="pl-4">Monitor</span>
            <span>24h</span>
            <span>Every</span>
            <span className="hidden lg:block">Pool</span>
            <span>Checked</span>
            <span className="w-[120px]" />
          </div>

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-14 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          ) : sections.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card/50 py-14 text-center text-sm text-muted-foreground">
              Nothing matches your filters.
              <Button
                variant="link"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                  setScope("all");
                }}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {sections.map((section, index) => {
                const stats = folderStats(section.all);
                const sectionIds = section.shown.map((monitor) => monitor.id);
                const chosen = sectionIds.filter((id) => selected.has(id)).length;
                const folder = section.folder;
                const position = folder ? allFolders.indexOf(folder) : -1;
                return (
                  <Section
                    key={section.key}
                    id={folder ? `group-${folder.id}` : "group-none"}
                    folder={folder}
                    ownerLabel={folder && me.data && folder.owner_id !== me.data.id ? folder.owner_email : undefined}
                    stats={stats}
                    collapsed={collapsed.has(section.key)}
                    onToggle={() => toggleCollapsed(section.key)}
                    checked={chosen > 0 && chosen === sectionIds.length}
                    indeterminate={chosen > 0 && chosen < sectionIds.length}
                    onCheck={(on) => setMany(sectionIds, on)}
                    dropping={dropTarget === section.key}
                    dropProps={dropProps(section.key)}
                    style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
                    menu={
                      <SectionMenu
                        folder={folder}
                        stats={stats}
                        canMoveUp={position > 0}
                        canMoveDown={position >= 0 && position < allFolders.length - 1}
                        onAdd={() => setCreating({ folderId: folder?.id })}
                        onImport={() => setImporting({ folderId: folder?.id })}
                        onManage={() => setFolderDialog({ folder, tab: "monitors" })}
                        onEdit={() => setFolderDialog({ folder, tab: "details" })}
                        onSharing={() => setFolderDialog({ folder, tab: "sharing" })}
                        onGroupThese={() =>
                          setFolderDialog({
                            folder: null,
                            tab: "details",
                            members: section.all.filter((monitor) => !me.data || monitor.owner_id === me.data.id).map((monitor) => monitor.id),
                          })
                        }
                        onCheckAll={() => {
                          const ids = section.all.filter((monitor) => monitor.enabled).map((monitor) => monitor.id);
                          if (ids.length) bulk.mutate({ ids, action: "check" });
                          else toast.message("Every monitor here is paused");
                        }}
                        onPauseAll={() => bulk.mutate({ ids: section.all.filter((monitor) => monitor.enabled).map((monitor) => monitor.id), action: "pause" })}
                        onResumeAll={() => bulk.mutate({ ids: section.all.filter((monitor) => !monitor.enabled).map((monitor) => monitor.id), action: "resume" })}
                        onMoveUp={() => folder && moveFolder(folder, -1)}
                        onMoveDown={() => folder && moveFolder(folder, 1)}
                        onDelete={() => folder && setDeletingFolder(folder)}
                      />
                    }
                  >
                    {section.shown.length === 0 ? (
                      <div className="m-3 flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center">
                        <p className="text-sm text-muted-foreground">
                          No monitors in this group yet. Drag monitors here, or
                        </p>
                        <div className="flex flex-wrap justify-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => setFolderDialog({ folder, tab: "monitors" })}>
                            <ListPlusIcon />
                            Pick existing monitors
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setCreating({ folderId: folder?.id })}>
                            <PlusIcon />
                            Add website
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setImporting({ folderId: folder?.id })}>
                            <UploadIcon />
                            Import list
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="divide-y">
                        {section.shown.map((monitor) => (
                          <MonitorRow
                            key={monitor.id}
                            monitor={monitor}
                            selected={selected.has(monitor.id)}
                            dimmed={Boolean(dragging?.includes(monitor.id))}
                            onSelect={(on) => setMany([monitor.id], on)}
                            onOpen={() => router.push(`/monitors/${monitor.id}`)}
                            onDragStart={(event) => onDragStart(event, monitor)}
                            onDragEnd={onDragEnd}
                            actions={
                              <MonitorRowActions
                                monitor={monitor}
                                pausing={togglingID === monitor.id}
                                onToggle={() => toggle.mutate(monitor)}
                                onEdit={() => setEditing(monitor)}
                                onDelete={() => setDeleting(monitor)}
                              />
                            }
                          />
                        ))}
                      </div>
                    )}
                  </Section>
                );
              })}
            </div>
          )}
        </>
      )}

      {selectedIds.length > 0 ? (
        <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
          <div className="flex animate-in items-center gap-1 rounded-xl border bg-popover/95 p-1.5 pl-3 text-sm shadow-lg ring-1 ring-foreground/5 backdrop-blur fade-in-0 slide-in-from-bottom-4">
            <span className="mr-1 font-medium tabular-nums">{selectedIds.length} selected</span>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" variant="ghost" disabled={bulk.isPending} />}>
                <FolderInputIcon />
                Move to
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-60">
                {selectionOwner ? (
                  <>
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Move to group</DropdownMenuLabel>
                      {moveTargets.map((folder) => (
                        <DropdownMenuItem key={folder.id} onClick={() => moveTo(selectedIds, folder.id)}>
                          <FolderGlyph color={folder.color} icon={folder.icon} size="sm" />
                          <span className="flex-1 truncate">{folder.name}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{folder.monitor_count}</span>
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuItem onClick={() => moveTo(selectedIds, UNGROUPED)}>
                        <FolderMinusIcon />
                        Remove from group
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    {me.data && selectionOwner === me.data.id ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setFolderDialog({ folder: null, tab: "details", members: selectedIds })}>
                          <FolderPlusIcon />
                          New group with these…
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </>
                ) : (
                  <p className="px-2 py-2 text-xs text-muted-foreground">The selection mixes monitors from different users. Pick monitors from one owner to move them.</p>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="ghost" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids: selectedIds, action: "check" })}>
              <RefreshCwIcon />
              <span className="hidden sm:inline">Check now</span>
            </Button>
            {anyRunning ? (
              <Button size="sm" variant="ghost" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids: selectedIds, action: "pause" })}>
                <PauseIcon />
                <span className="hidden sm:inline">Pause</span>
              </Button>
            ) : null}
            {anyPaused ? (
              <Button size="sm" variant="ghost" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids: selectedIds, action: "resume" })}>
                <PlayIcon />
                <span className="hidden sm:inline">Resume</span>
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={bulk.isPending} onClick={() => setConfirmBulkDelete(true)}>
              <Trash2Icon />
              <span className="hidden sm:inline">Delete</span>
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button size="icon-sm" variant="ghost" title="Clear selection" onClick={() => setSelected(new Set())}>
              <XIcon />
            </Button>
          </div>
        </div>
      ) : null}

      <div ref={ghost} className="pointer-events-none fixed -top-96 left-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-lg" />

      <ImportMonitorsDialog
        open={Boolean(importing)}
        onOpenChange={(open) => !open && setImporting(null)}
        defaultFolderId={importing?.folderId}
        onImported={() => {
          void client.invalidateQueries({ queryKey: ["monitors"] });
          void client.invalidateQueries({ queryKey: ["monitor-folders"] });
          void client.invalidateQueries({ queryKey: ["overview"] });
        }}
      />
      <MonitorDialog
        open={Boolean(creating)}
        onOpenChange={(open) => !open && setCreating(null)}
        defaultFolderId={creating?.folderId}
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
      <FolderDialog
        open={Boolean(folderDialog)}
        onOpenChange={(open) => !open && setFolderDialog(null)}
        folder={folderDialog?.folder}
        folders={allFolders}
        monitors={allMonitors}
        ownerId={me.data?.id}
        initialTab={folderDialog?.tab}
        initialMemberIds={folderDialog?.members}
        onSaved={() => setSelected(new Set())}
      />
      <DeleteMonitorDialog
        monitor={deleting}
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={(monitor) => remove.mutate(monitor, { onSuccess: () => setDeleting(null) })}
      />
      <AlertDialog open={Boolean(deletingFolder)} onOpenChange={(open) => !open && setDeletingFolder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete group {deletingFolder?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its {deletingFolder?.monitor_count ?? 0} monitor{deletingFolder?.monitor_count === 1 ? "" : "s"} keep running and move to Ungrouped.
              {deletingFolder?.public_enabled ? " The group status page stops working." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={removeFolder.isPending} onClick={() => deletingFolder && removeFolder.mutate(deletingFolder)}>
              Delete group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.length} monitor{selectedIds.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>All of their check history is removed. Pause them instead if you only want to stop checks.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={bulk.isPending}
              onClick={() =>
                bulk.mutate(
                  { ids: selectedIds, action: "delete" },
                  {
                    onSuccess: () => {
                      setConfirmBulkDelete(false);
                      setSelected(new Set());
                    },
                  },
                )
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Section({
  id,
  folder,
  ownerLabel,
  stats,
  collapsed,
  onToggle,
  checked,
  indeterminate,
  onCheck,
  dropping,
  dropProps,
  menu,
  style,
  children,
}: {
  id: string;
  folder: MonitorFolder | null;
  ownerLabel?: string;
  stats: FolderStats;
  collapsed: boolean;
  onToggle: () => void;
  checked: boolean;
  indeterminate: boolean;
  onCheck: (on: boolean) => void;
  dropping: boolean;
  dropProps: { onDragOver: (event: DragEvent) => void; onDragLeave: (event: DragEvent) => void; onDrop: (event: DragEvent) => void };
  menu: ReactNode;
  style?: React.CSSProperties;
  children: ReactNode;
}) {
  const tone = folder ? FOLDER_COLORS[folder.color] : null;
  return (
    <section
      id={id}
      style={style}
      {...dropProps}
      className={cn(
        "relative scroll-mt-16 animate-in overflow-hidden rounded-xl border bg-card fade-in-0 slide-in-from-bottom-1 fill-mode-both transition-shadow",
        dropping && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background",
      )}
    >
      {tone ? <span className={cn("absolute inset-y-0 left-0 w-1", tone.bar)} /> : null}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        className={cn("flex cursor-pointer items-center gap-3 px-4 py-3 select-none hover:bg-muted/40", !collapsed && "border-b")}
      >
        <div className="flex w-[28px] items-center" onClick={(event) => event.stopPropagation()}>
          <Checkbox checked={checked} indeterminate={indeterminate} disabled={stats.total === 0} onCheckedChange={(value) => onCheck(value === true)} aria-label="Select all in group" />
        </div>
        <ChevronRightIcon className={cn("-ml-2 size-4 shrink-0 text-muted-foreground transition-transform", !collapsed && "rotate-90")} />
        {folder ? (
          <FolderGlyph color={folder.color} icon={folder.icon} />
        ) : (
          <span className="inline-flex size-7 items-center justify-center rounded-md border border-dashed text-muted-foreground">
            <FolderMinusIcon className="size-3.5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate font-medium">{folder?.name ?? "Ungrouped"}</h2>
            <span className="text-xs text-muted-foreground tabular-nums">{stats.total}</span>
            {folder?.public_enabled ? (
              <span title={folder.public_protected ? "Group status page, password protected" : "Group status page is public"} className="text-muted-foreground">
                {folder.public_protected ? <LockIcon className="size-3" /> : <GlobeIcon className="size-3" />}
              </span>
            ) : null}
            {ownerLabel ? <Badge variant="secondary" className="hidden sm:inline-flex">{ownerLabel}</Badge> : null}
          </div>
          {folder?.description ? <p className="truncate text-xs text-muted-foreground">{folder.description}</p> : null}
        </div>
        <SectionHealth stats={stats} />
        <div onClick={(event) => event.stopPropagation()}>{menu}</div>
      </div>
      {collapsed ? null : children}
    </section>
  );
}

function SectionHealth({ stats }: { stats: FolderStats }) {
  if (stats.total === 0) return null;
  const segments = [
    { n: stats.ok, cls: "bg-emerald-500", label: "up" },
    { n: stats.pending, cls: "bg-amber-500", label: "checking" },
    { n: stats.fail, cls: "bg-destructive", label: "failing" },
    { n: stats.paused + stats.unknown, cls: "bg-muted-foreground/30", label: "paused or no data" },
  ].filter((segment) => segment.n > 0);
  const summary = segments.map((segment) => `${segment.n} ${segment.label}`).join(" · ");
  return (
    <div className="hidden items-center gap-4 sm:flex" title={summary}>
      <div className="flex items-center gap-3 text-xs">
        {stats.fail > 0 ? (
          <span className="inline-flex items-center gap-1 font-medium text-destructive">
            <span className="size-1.5 rounded-full bg-destructive" />
            {stats.fail} down
          </span>
        ) : stats.ok > 0 && stats.ok === stats.total ? (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            All up
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {stats.ok} up
          </span>
        )}
        {stats.paused > 0 ? <span className="text-muted-foreground">{stats.paused} paused</span> : null}
      </div>
      <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        {segments.map((segment) => (
          <span key={segment.label} className={cn("h-full", segment.cls)} style={{ width: `${(segment.n / stats.total) * 100}%` }} />
        ))}
      </div>
      <span className="w-16 text-right font-mono text-xs text-muted-foreground" title="Average 24h uptime">
        {formatUptime(stats.uptime)}
      </span>
    </div>
  );
}

function SectionMenu({
  folder,
  stats,
  canMoveUp,
  canMoveDown,
  onAdd,
  onImport,
  onManage,
  onEdit,
  onSharing,
  onGroupThese,
  onCheckAll,
  onPauseAll,
  onResumeAll,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  folder: MonitorFolder | null;
  stats: FolderStats;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onAdd: () => void;
  onImport: () => void;
  onManage: () => void;
  onEdit: () => void;
  onSharing: () => void;
  onGroupThese: () => void;
  onCheckAll: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const running = stats.total - stats.paused;
  const link = folder?.public_enabled && folder.public_slug ? groupShareURL(folder.public_slug) : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" title="Group actions" />}>
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={onAdd}>
          <PlusIcon />
          Add website here
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImport}>
          <UploadIcon />
          Import into group
        </DropdownMenuItem>
        {folder ? (
          <>
            <DropdownMenuItem onClick={onManage}>
              <ListPlusIcon />
              Choose monitors…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <PencilIcon />
              Edit group…
            </DropdownMenuItem>
          </>
        ) : stats.total > 0 ? (
          <DropdownMenuItem onClick={onGroupThese}>
            <FolderPlusIcon />
            Put these in a new group…
          </DropdownMenuItem>
        ) : null}
        {stats.total > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={running === 0} onClick={onCheckAll}>
              <RefreshCwIcon />
              Check all now
            </DropdownMenuItem>
            <DropdownMenuItem disabled={running === 0} onClick={onPauseAll}>
              <PauseIcon />
              Pause all
            </DropdownMenuItem>
            <DropdownMenuItem disabled={stats.paused === 0} onClick={onResumeAll}>
              <PlayIcon />
              Resume all
            </DropdownMenuItem>
          </>
        ) : null}
        {folder ? (
          <>
            <DropdownMenuSeparator />
            {link ? (
              <>
                <DropdownMenuItem onClick={() => copyText(link, folder.public_protected ? "Link copied (password protected)" : "Link copied")}>
                  <LinkIcon />
                  Copy status page link
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(link, "_blank", "noopener")}>
                  <ExternalLinkIcon />
                  Open status page
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onClick={onSharing}>
                <GlobeIcon />
                Share a status page…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!canMoveUp} onClick={onMoveUp}>
              <ArrowUpIcon />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveDown} onClick={onMoveDown}>
              <ArrowDownIcon />
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete group
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MonitorRow({
  monitor,
  selected,
  dimmed,
  onSelect,
  onOpen,
  onDragStart,
  onDragEnd,
  actions,
}: {
  monitor: Monitor;
  selected: boolean;
  dimmed: boolean;
  onSelect: (on: boolean) => void;
  onOpen: () => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  actions: ReactNode;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn(
        ROW_GRID,
        "group/row cursor-pointer px-4 py-2.5 text-sm transition-colors",
        selected ? "bg-primary/5" : "hover:bg-muted/40",
        dimmed && "opacity-40",
      )}
    >
      <div className="relative flex items-center" onClick={(event) => event.stopPropagation()}>
        <GripVerticalIcon className="absolute -left-3.5 size-3.5 text-muted-foreground/0 transition-colors group-hover/row:text-muted-foreground/60" />
        <Checkbox checked={selected} onCheckedChange={(value) => onSelect(value === true)} aria-label={`Select ${monitor.name}`} />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={monitor.last_status} paused={!monitor.enabled} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn("truncate font-medium", !monitor.enabled && "text-muted-foreground")}>{monitor.name}</span>
            {monitor.public_enabled ? (
              <span title={monitor.public_protected ? "Public page, password protected" : "Public page"} className="text-muted-foreground">
                {monitor.public_protected ? <LockIcon className="size-3" /> : <GlobeIcon className="size-3" />}
              </span>
            ) : null}
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{monitor.target_url}</p>
        </div>
      </div>
      <span className="hidden font-mono text-xs md:block">{formatUptime(monitor.uptime_24h)}</span>
      <span className="hidden text-xs md:block">{formatInterval(monitor.interval_sec)}</span>
      <div className="hidden min-w-0 flex-wrap gap-1 lg:flex">
        {monitor.groups.map((group) => (
          <Badge key={group.id} variant="secondary" className="max-w-full truncate">
            {group.name}
          </Badge>
        ))}
      </div>
      <span className="hidden text-xs text-muted-foreground md:block">{formatAgo(monitor.last_checked_at)}</span>
      <div className="w-[120px]">{actions}</div>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex rounded-lg bg-muted p-[3px] text-xs">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-2.5 py-1 whitespace-nowrap transition-colors",
            value === option.value ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Chip({
  active,
  dropping,
  children,
  ...props
}: { active: boolean; dropping?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-all",
        active ? "border-foreground/20 bg-foreground text-background" : "bg-card text-foreground hover:border-foreground/25",
        dropping && "scale-105 border-primary ring-2 ring-primary/40",
      )}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: ReactNode }) {
  return <span className="tabular-nums opacity-60">{children}</span>;
}

function EmptyState({ onCreate, onImport, onGroup }: { onCreate: () => void; onImport: () => void; onGroup: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed bg-card/50 px-6 py-16 text-center">
      <div className="mb-4 flex -space-x-2">
        <FolderGlyph color="sky" icon="globe" size="lg" className="-rotate-6" />
        <FolderGlyph color="emerald" icon="server" size="lg" className="z-10" />
        <FolderGlyph color="violet" icon="cart" size="lg" className="rotate-6" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight">Start watching your sites</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">Add a URL or import a list. Groups keep related monitors together, with one health summary and an optional shared status page.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={onCreate}>
          <PlusIcon />
          Add website
        </Button>
        <Button variant="outline" onClick={onImport}>
          <UploadIcon />
          Import list
        </Button>
        <Button variant="ghost" onClick={onGroup}>
          <FolderPlusIcon />
          Create a group first
        </Button>
      </div>
    </div>
  );
}
