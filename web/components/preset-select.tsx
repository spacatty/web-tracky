"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { describeSuccess } from "@/lib/success";
import type { StatusTemplate } from "@/lib/types";

export function useStatusTemplates() {
  return useQuery({ queryKey: ["status-templates"], queryFn: () => api<StatusTemplate[]>("/api/status-templates") });
}

export function PresetSelect({
  value,
  onChange,
  includeCustom = false,
  fallbackName = "",
}: {
  value: string;
  onChange: (value: string) => void;
  includeCustom?: boolean;
  fallbackName?: string;
}) {
  const templates = useStatusTemplates();
  const selected = (templates.data ?? []).find((template) => template.id === value);
  const known = value === "default" || value === "custom" || Boolean(selected);
  function labelFor(current: string | null) {
    if (!current || current === "default") return "Default (2xx–3xx)";
    if (current === "custom") return "Custom rules";
    return (templates.data ?? []).find((template) => template.id === current)?.name || fallbackName || "Saved preset";
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label>Status preset</Label>
        <Link href="/presets" className="text-xs text-muted-foreground hover:text-foreground">
          Manage
        </Link>
      </div>
      <Select value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Default (2xx–3xx)">{(current) => labelFor(typeof current === "string" ? current : null)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Default (2xx–3xx)</SelectItem>
          {includeCustom ? <SelectItem value="custom">Custom rules</SelectItem> : null}
          {!known ? <SelectItem value={value}>{fallbackName || "Saved preset"}</SelectItem> : null}
          {(templates.data ?? []).map((template) => (
            <SelectItem key={template.id} value={template.id}>
              {template.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected ? <p className="text-xs text-muted-foreground">{describeSuccess(selected.success_rules)}</p> : null}
      {value === "default" ? <p className="text-xs text-muted-foreground">A check passes on HTTP 2xx–3xx.</p> : null}
    </div>
  );
}
