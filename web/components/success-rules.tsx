"use client";

import { InfoIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { blankRule, type DraftRule } from "@/lib/success";

export function SuccessRulesField({
  enabled,
  rules,
  onEnabledChange,
  onChange,
}: {
  enabled: boolean;
  rules: DraftRule[];
  onEnabledChange: (enabled: boolean) => void;
  onChange: (rules: DraftRule[]) => void;
}) {
  function update(index: number, patch: Partial<DraftRule>) {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Label>Custom success</Label>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="About custom success matching" />
              }
            >
              <InfoIcon />
            </TooltipTrigger>
            <TooltipContent className="max-w-64 text-left leading-snug">
              When this is on, a check succeeds only if it matches the rules below. HTTP 200 is not a success unless you add a rule for it. Each rule is a status and a body check. Later rules combine from the top with and or or.
            </TooltipContent>
          </Tooltip>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => {
            onEnabledChange(checked);
            if (checked && rules.length === 0) onChange([blankRule()]);
          }}
        />
      </div>
      {enabled ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Only these rules count. HTTP 200 is not included unless you add it.</p>
          {rules.map((rule, index) => (
            <div key={index} className="flex flex-wrap items-center gap-1.5">
              {index === 0 ? (
                <span className="w-20 text-xs text-muted-foreground">when</span>
              ) : (
                <Select
                  value={rule.join}
                  onValueChange={(value) => {
                    if (value === "and" || value === "or") update(index, { join: value });
                  }}
                >
                  <SelectTrigger aria-label={`Combine rule ${index + 1}`} className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value="or">or</SelectItem>
                    <SelectItem value="and">and</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Input
                aria-label={`HTTP status ${index + 1}`}
                className="w-20 font-mono"
                inputMode="numeric"
                placeholder="404"
                value={rule.status}
                onChange={(event) => update(index, { status: event.target.value })}
              />
              <Select
                value={rule.body}
                onValueChange={(value) => {
                  if (value === "any" || value === "empty" || value === "contains") update(index, { body: value });
                }}
              >
                <SelectTrigger aria-label={`Body match ${index + 1}`} className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="any">any body</SelectItem>
                  <SelectItem value="empty">empty body</SelectItem>
                  <SelectItem value="contains">body contains</SelectItem>
                </SelectContent>
              </Select>
              {rule.body === "contains" ? (
                <Input
                  aria-label={`Response text ${index + 1}`}
                  className="min-w-32 flex-1"
                  placeholder="404 not found"
                  maxLength={200}
                  value={rule.text}
                  onChange={(event) => update(index, { text: event.target.value })}
                />
              ) : null}
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove rule ${index + 1}`} onClick={() => onChange(rules.filter((_, i) => i !== index))}>
                <XIcon />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rules.length >= 8}
            onClick={() => {
              const prev = rules[rules.length - 1];
              onChange([...rules, { status: prev?.status ?? "", body: "contains", text: "", join: "or" }]);
            }}
          >
            Add rule
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Default success is HTTP 2xx–3xx.</p>
      )}
    </div>
  );
}
