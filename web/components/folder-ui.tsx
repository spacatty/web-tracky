"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ChevronsUpDownIcon, FolderMinusIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, errorMessage } from "@/lib/api";
import { FOLDER_COLORS, FOLDER_ICONS, colorNames, useFolders } from "@/lib/folders";
import type { FolderColor, FolderIcon, MonitorFolder } from "@/lib/types";

export function FolderGlyph({ color, icon, size = "md", className }: { color: FolderColor; icon: FolderIcon; size?: "sm" | "md" | "lg"; className?: string }) {
  const Icon = FOLDER_ICONS[icon] ?? FOLDER_ICONS.folder;
  const tone = FOLDER_COLORS[color] ?? FOLDER_COLORS.slate;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md",
        tone.soft,
        size === "sm" && "size-5 [&_svg]:size-3",
        size === "md" && "size-7 [&_svg]:size-3.5",
        size === "lg" && "size-10 rounded-lg [&_svg]:size-5",
        className,
      )}
    >
      <Icon />
    </span>
  );
}

export function FolderBadge({ folder, className }: { folder: Pick<MonitorFolder, "name" | "color" | "icon">; className?: string }) {
  const tone = FOLDER_COLORS[folder.color] ?? FOLDER_COLORS.slate;
  const Icon = FOLDER_ICONS[folder.icon] ?? FOLDER_ICONS.folder;
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", tone.soft, className)}>
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{folder.name}</span>
    </span>
  );
}

export function useCreateFolder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color: FolderColor }) =>
      api<MonitorFolder>("/api/monitor-folders", { method: "POST", body: JSON.stringify({ name: input.name, color: input.color, icon: "folder" }) }),
    onSuccess: (folder) => {
      toast.success(`Group “${folder.name}” created`);
      void client.invalidateQueries({ queryKey: ["monitor-folders"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Could not create group")),
  });
}

export function FolderSelect({
  value,
  onChange,
  ownerId,
  className,
}: {
  value: string;
  onChange: (id: string, folder: MonitorFolder | null) => void;
  ownerId?: string;
  className?: string;
}) {
  const folders = useFolders();
  const create = useCreateFolder();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useMemo(() => (folders.data ?? []).filter((folder) => !ownerId || folder.owner_id === ownerId), [folders.data, ownerId]);
  const selected = list.find((folder) => folder.id === value) ?? null;
  const term = query.trim().toLowerCase();
  const matches = term ? list.filter((folder) => folder.name.toLowerCase().includes(term)) : list;
  const exact = list.some((folder) => folder.name.toLowerCase() === term);
  const canCreate = term.length > 0 && !exact;
  const options: ({ kind: "none" } | { kind: "folder"; folder: MonitorFolder } | { kind: "create" })[] = [
    ...(term ? [] : [{ kind: "none" as const }]),
    ...matches.map((folder) => ({ kind: "folder" as const, folder })),
    ...(canCreate ? [{ kind: "create" as const }] : []),
  ];

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };

  const choose = (option: (typeof options)[number] | undefined) => {
    if (!option) return;
    if (option.kind === "none") {
      onChange("", null);
      close();
    } else if (option.kind === "folder") {
      onChange(option.folder.id, option.folder);
      close();
    } else {
      create.mutate(
        { name: query.trim(), color: colorNames[(list.length + 4) % colorNames.length] },
        {
          onSuccess: (folder) => {
            onChange(folder.id, folder);
            close();
          },
        },
      );
    }
  };

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" className={cn("w-full justify-between font-normal", className)} />
        }
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-2">
            <FolderGlyph color={selected.color} icon={selected.icon} size="sm" />
            <span className="truncate">{selected.name}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 text-muted-foreground">
            <FolderMinusIcon className="size-4" />
            No group
          </span>
        )}
        <ChevronsUpDownIcon className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 gap-0 p-0">
        <div className="flex items-center gap-2 border-b px-2.5">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((i) => Math.min(i + 1, options.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(options[active]);
              }
            }}
            placeholder="Find or create a group…"
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {options.length === 0 ? <p className="px-2 py-3 text-center text-xs text-muted-foreground">Type a name to create your first group.</p> : null}
          {options.map((option, i) => {
            const isActive = i === active;
            const base = cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none",
              isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
            );
            if (option.kind === "none") {
              return (
                <button key="none" type="button" className={base} onMouseEnter={() => setActive(i)} onClick={() => choose(option)}>
                  <span className="inline-flex size-5 items-center justify-center rounded-md border border-dashed text-muted-foreground">
                    <FolderMinusIcon className="size-3" />
                  </span>
                  <span className="flex-1 text-muted-foreground">No group</span>
                  {!value ? <CheckIcon className="size-4" /> : null}
                </button>
              );
            }
            if (option.kind === "create") {
              return (
                <button key="create" type="button" disabled={create.isPending} className={base} onMouseEnter={() => setActive(i)} onClick={() => choose(option)}>
                  <span className="inline-flex size-5 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <PlusIcon className="size-3" />
                  </span>
                  <span className="flex-1 truncate">
                    Create <span className="font-medium">“{query.trim()}”</span>
                  </span>
                </button>
              );
            }
            const folder = option.folder;
            return (
              <button key={folder.id} type="button" className={base} onMouseEnter={() => setActive(i)} onClick={() => choose(option)}>
                <FolderGlyph color={folder.color} icon={folder.icon} size="sm" />
                <span className="flex-1 truncate">{folder.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{folder.monitor_count}</span>
                {folder.id === value ? <CheckIcon className="size-4" /> : <span className="size-4" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
