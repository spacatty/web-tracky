"use client";

import { InfoIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { blankRule, type DraftRule } from "@/lib/success";

const field =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

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
                <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="About custom success matching" />
              }
            >
              <InfoIcon className="size-3.5" />
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
                <span className="w-14 text-xs text-muted-foreground">when</span>
              ) : (
                <select
                  aria-label={`Combine rule ${index + 1}`}
                  className={`${field} w-14`}
                  value={rule.join}
                  onChange={(event) => update(index, { join: event.target.value as DraftRule["join"] })}
                >
                  <option value="or">or</option>
                  <option value="and">and</option>
                </select>
              )}
              <Input
                aria-label={`HTTP status ${index + 1}`}
                className="w-20 font-mono"
                inputMode="numeric"
                placeholder="404"
                value={rule.status}
                onChange={(event) => update(index, { status: event.target.value })}
              />
              <select
                aria-label={`Body match ${index + 1}`}
                className={`${field} w-36`}
                value={rule.body}
                onChange={(event) => update(index, { body: event.target.value as DraftRule["body"] })}
              >
                <option value="any">any body</option>
                <option value="empty">empty body</option>
                <option value="contains">body contains</option>
              </select>
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
