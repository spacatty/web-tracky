"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckIcon, GlobeIcon, LockIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Group } from "@/lib/types";

export function GroupChecks({
  ids,
  onChange,
  defaultPrivate = true,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  defaultPrivate?: boolean;
}) {
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<Group[]>("/api/groups") });
  const list = [...(groups.data ?? [])].sort((a, b) => Number(b.visibility === "private") - Number(a.visibility === "private") || a.name.localeCompare(b.name));
  const seeded = useRef(!defaultPrivate);

  useEffect(() => {
    if (seeded.current || !groups.data) return;
    seeded.current = true;
    if (ids.length > 0) return;
    const priv = groups.data.filter((group) => group.visibility === "private").map((group) => group.id);
    if (priv.length > 0) onChange(priv);
  }, [groups.data, ids.length, onChange]);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label>Pool</Label>
        {list.length > 1 ? <span className="text-xs text-muted-foreground">{ids.length} of {list.length} selected</span> : null}
      </div>
      {groups.isSuccess && list.length === 0 ? <p className="text-xs text-muted-foreground">No pools yet. Create one before checks can run.</p> : null}
      <div className="grid gap-1.5">
        {list.map((group) => {
          const on = ids.includes(group.id);
          const Icon = group.visibility === "private" ? LockIcon : GlobeIcon;
          return (
            <button
              key={group.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => onChange(on ? ids.filter((id) => id !== group.id) : [...ids, group.id])}
              className={cn(
                "flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                on ? "border-primary/60 bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                {on ? <CheckIcon className="size-3" /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                <Icon className="size-3" />
                {group.visibility}
                <span className="text-muted-foreground/50">·</span>
                {group.node_count} node{group.node_count === 1 ? "" : "s"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
