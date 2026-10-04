"use client";

import { useQuery } from "@tanstack/react-query";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { Group } from "@/lib/types";

export function GroupChecks({ ids, onChange }: { ids: string[]; onChange: (ids: string[]) => void }) {
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<Group[]>("/api/groups") });
  const list = groups.data ?? [];
  return (
    <div className="space-y-2">
      <Label>Pool</Label>
      {groups.isSuccess && list.length === 0 ? <p className="text-xs text-muted-foreground">No groups yet. Create one before checks can run.</p> : null}
      {list.map((group) => (
        <Label key={group.id} className="font-normal">
          <Checkbox
            checked={ids.includes(group.id)}
            onCheckedChange={(checked) => onChange(checked ? [...ids, group.id] : ids.filter((id) => id !== group.id))}
          />
          {group.name}
          <span className="text-xs text-muted-foreground">{group.visibility}</span>
        </Label>
      ))}
    </div>
  );
}
