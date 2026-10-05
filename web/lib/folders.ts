"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BriefcaseIcon,
  CloudIcon,
  CodeIcon,
  DatabaseIcon,
  FolderIcon,
  GlobeIcon,
  HeartIcon,
  ServerIcon,
  ShieldIcon,
  ShoppingCartIcon,
  StarIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { api, errorMessage } from "@/lib/api";
import type { BulkAction, FolderColor, FolderIcon as FolderIconName, Monitor, MonitorFolder } from "@/lib/types";

// Tailwind only ships classes it can see literally, so every tone is spelled out.
export const FOLDER_COLORS: Record<FolderColor, { dot: string; soft: string; ring: string; bar: string }> = {
  slate: { dot: "bg-slate-500", soft: "bg-slate-500/12 text-slate-600 dark:text-slate-300", ring: "ring-slate-500", bar: "bg-slate-500" },
  red: { dot: "bg-red-500", soft: "bg-red-500/12 text-red-600 dark:text-red-400", ring: "ring-red-500", bar: "bg-red-500" },
  orange: { dot: "bg-orange-500", soft: "bg-orange-500/12 text-orange-600 dark:text-orange-400", ring: "ring-orange-500", bar: "bg-orange-500" },
  amber: { dot: "bg-amber-500", soft: "bg-amber-500/12 text-amber-600 dark:text-amber-400", ring: "ring-amber-500", bar: "bg-amber-500" },
  lime: { dot: "bg-lime-500", soft: "bg-lime-500/12 text-lime-700 dark:text-lime-400", ring: "ring-lime-500", bar: "bg-lime-500" },
  emerald: { dot: "bg-emerald-500", soft: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-500", bar: "bg-emerald-500" },
  teal: { dot: "bg-teal-500", soft: "bg-teal-500/12 text-teal-600 dark:text-teal-400", ring: "ring-teal-500", bar: "bg-teal-500" },
  sky: { dot: "bg-sky-500", soft: "bg-sky-500/12 text-sky-600 dark:text-sky-400", ring: "ring-sky-500", bar: "bg-sky-500" },
  blue: { dot: "bg-blue-500", soft: "bg-blue-500/12 text-blue-600 dark:text-blue-400", ring: "ring-blue-500", bar: "bg-blue-500" },
  indigo: { dot: "bg-indigo-500", soft: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400", ring: "ring-indigo-500", bar: "bg-indigo-500" },
  violet: { dot: "bg-violet-500", soft: "bg-violet-500/12 text-violet-600 dark:text-violet-400", ring: "ring-violet-500", bar: "bg-violet-500" },
  pink: { dot: "bg-pink-500", soft: "bg-pink-500/12 text-pink-600 dark:text-pink-400", ring: "ring-pink-500", bar: "bg-pink-500" },
};

export const FOLDER_ICONS: Record<FolderIconName, LucideIcon> = {
  folder: FolderIcon,
  globe: GlobeIcon,
  server: ServerIcon,
  database: DatabaseIcon,
  cart: ShoppingCartIcon,
  shield: ShieldIcon,
  zap: ZapIcon,
  cloud: CloudIcon,
  code: CodeIcon,
  briefcase: BriefcaseIcon,
  heart: HeartIcon,
  star: StarIcon,
};

export const colorNames = Object.keys(FOLDER_COLORS) as FolderColor[];
export const iconNames = Object.keys(FOLDER_ICONS) as FolderIconName[];

export function useFolders() {
  return useQuery({ queryKey: ["monitor-folders"], queryFn: () => api<MonitorFolder[]>("/api/monitor-folders") });
}

export function useRefreshMonitors() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ["monitors"] });
    void client.invalidateQueries({ queryKey: ["monitor-folders"] });
    void client.invalidateQueries({ queryKey: ["monitor"] });
    void client.invalidateQueries({ queryKey: ["overview"] });
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function useBulkMonitors() {
  const refresh = useRefreshMonitors();
  return useMutation({
    mutationFn: (input: { ids: string[]; action: BulkAction; folder_id?: string; folderName?: string }) =>
      api<{ affected: number; no_nodes?: number }>("/api/monitors/bulk", {
        method: "POST",
        body: JSON.stringify({ ids: input.ids, action: input.action, folder_id: input.folder_id ?? "" }),
      }),
    onSuccess: (result, input) => {
      const n = plural(result.affected, "monitor");
      switch (input.action) {
        case "pause":
          toast.success(`Paused ${n}`);
          break;
        case "resume":
          toast.success(`Resumed ${n}`);
          break;
        case "delete":
          toast.success(`Deleted ${n}`);
          break;
        case "move":
          toast.success(input.folder_id ? `Moved ${n} to ${input.folderName ?? "group"}` : `Removed ${n} from their group`);
          break;
        case "check":
          if (result.no_nodes && result.no_nodes === result.affected) toast.message("No online agents in these pools");
          else toast.success(`Checking ${n} now`);
          break;
      }
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Could not update monitors")),
  });
}

export type FolderStats = {
  total: number;
  ok: number;
  fail: number;
  pending: number;
  paused: number;
  unknown: number;
  uptime: number | null;
};

export function folderStats(monitors: Monitor[]): FolderStats {
  const stats: FolderStats = { total: monitors.length, ok: 0, fail: 0, pending: 0, paused: 0, unknown: 0, uptime: null };
  let sum = 0;
  let counted = 0;
  for (const monitor of monitors) {
    if (!monitor.enabled) stats.paused += 1;
    else if (monitor.last_status === "ok") stats.ok += 1;
    else if (monitor.last_status === "fail") stats.fail += 1;
    else if (monitor.last_status === "pending") stats.pending += 1;
    else stats.unknown += 1;
    if (monitor.uptime_24h != null) {
      sum += monitor.uptime_24h;
      counted += 1;
    }
  }
  stats.uptime = counted ? sum / counted : null;
  return stats;
}
