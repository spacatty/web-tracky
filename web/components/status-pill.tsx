import { cn } from "cn";

const tones: Record<string, string> = {
  online: "bg-emerald-500",
  ok: "bg-emerald-500",
  pending: "bg-amber-500",
  fail: "bg-destructive",
  offline: "bg-muted-foreground/50",
  unknown: "bg-muted-foreground/40",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = tones[status] ?? tones.unknown;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium capitalize">
      <span className={cn("size-1.5 rounded-full", tone, status === "pending" && "animate-pulse")} />
      {label ?? status}
    </span>
  );
}
