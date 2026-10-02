export function formatMs(ms?: number | null) {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

export function formatRate(bps?: number | null) {
  if (!bps) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let value = bps;
  let index = 0;
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000;
    index += 1;
  }
  const digits = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

export function formatSpeed(bps?: number | null) {
  if (bps == null || bps <= 0) return "—";
  if (bps >= 1_000_000_000) {
    const value = bps / 1_000_000_000;
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} Gbps`;
  }
  if (bps >= 1_000_000) {
    const value = bps / 1_000_000;
    return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} Mbps`;
  }
  if (bps >= 1_000) return `${Math.round(bps / 1_000)} Kbps`;
  return `${Math.round(bps)} bps`;
}

export function formatLink(bps?: number | null) {
  if (!bps) return "—";
  const mbps = bps / 1_000_000;
  if (mbps >= 1000) {
    const gbps = mbps / 1000;
    return `${gbps >= 10 ? gbps.toFixed(0) : gbps.toFixed(1)} Gbps`;
  }
  return `${Math.round(mbps)} Mbps`;
}

export function formatAgo(iso?: string | null) {
  if (!iso) return "never";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 0) return `in ${formatSpan(-seconds)}`;
  if (seconds < 5) return "just now";
  return `${formatSpan(seconds)} ago`;
}

function formatSpan(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export function formatUptime(value?: number | null) {
  if (value == null) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

export function formatInterval(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = seconds / 3600;
  return `${hours >= 10 ? hours.toFixed(0) : hours.toFixed(hours % 1 === 0 ? 0 : 1)}h`;
}

export function locationLabel(city?: string, code?: string, name?: string) {
  if (city && code) return `${code} ${city}`;
  return code || city || name || "Unknown";
}

export const INTERVAL_STOPS = [30, 60, 120, 300, 600, 900, 1800, 3600];

export function intervalStops(min: number) {
  const stops = INTERVAL_STOPS.filter((stop) => stop >= min);
  return stops.length > 0 ? stops : [min];
}
