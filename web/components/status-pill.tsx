import { cn } from "cn";

const tones: Record<string, string> = {
  online: "bg-emerald-500",
  ok: "bg-emerald-500",
  pending: "bg-amber-500",
  fail: "bg-destructive",
  offline: "bg-muted-foreground/50",
  unknown: "bg-muted-foreground/40",
};

const halos: Record<string, string> = {
  ok: "shadow-[0_0_0_3px] shadow-emerald-500/15",
  pending: "shadow-[0_0_0_3px] shadow-amber-500/15",
  fail: "shadow-[0_0_0_3px] shadow-destructive/20",
};

const statusLabels: Record<string, string> = {
  ok: "Up",
  fail: "Down",
  pending: "Checking",
  unknown: "No data yet",
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

export function StatusDot({ status, paused, className }: { status: string; paused?: boolean; className?: string }) {
  const label = paused ? "Paused" : (statusLabels[status] ?? status);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        paused ? "border-[1.5px] border-muted-foreground/60 bg-transparent" : [tones[status] ?? tones.unknown, halos[status], status === "pending" && "animate-pulse"],
        className,
      )}
    />
  );
}
