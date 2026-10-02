export const chartPresets = [
  { id: "1h", label: "1 hour" },
  { id: "12h", label: "12 hours" },
  { id: "24h", label: "24 hours" },
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
] as const;

export type ChartPreset = (typeof chartPresets)[number]["id"];
export type ChartPresetId = ChartPreset | "custom";

export type ChartWindow = {
  preset: ChartPresetId;
  from: Date;
  to: Date;
};

const presetMs: Record<Exclude<ChartPreset, "today">, number> = {
  "1h": 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export function windowFor(preset: ChartPreset, now = new Date()): ChartWindow {
  if (preset === "today") {
    return {
      preset,
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
      to: now,
    };
  }
  return { preset, from: new Date(now.getTime() - presetMs[preset]), to: now };
}

export function presetLabel(id: ChartPresetId) {
  if (id === "custom") return "Custom";
  return chartPresets.find((item) => item.id === id)?.label ?? "Custom";
}

export function rangeQuery(window: ChartWindow) {
  const params = new URLSearchParams({
    from: window.from.toISOString(),
    to: window.to.toISOString(),
  });
  return params.toString();
}

export function withDate(current: Date, day: Date) {
  const next = new Date(current);
  next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
  return next;
}

export function withTime(current: Date, value: string) {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return current;
  const next = new Date(current);
  next.setHours(hour, minute, 0, 0);
  return next;
}

const maxSpan = 31 * 24 * 60 * 60 * 1000;

export function clampWindow(from: Date, to: Date, edited: "from" | "to"): ChartWindow {
  let start = from;
  let end = to;
  if (start.getTime() >= end.getTime()) {
    if (edited === "from") end = new Date(start.getTime() + 60 * 60 * 1000);
    else start = new Date(end.getTime() - 60 * 60 * 1000);
  }
  if (end.getTime() - start.getTime() > maxSpan) {
    if (edited === "from") end = new Date(start.getTime() + maxSpan);
    else start = new Date(end.getTime() - maxSpan);
  }
  return { preset: "custom", from: start, to: end };
}

export function tickLabel(from: Date, to: Date, value: unknown) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  if (to.getTime() - from.getTime() > 36 * 60 * 60 * 1000) {
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" });
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
