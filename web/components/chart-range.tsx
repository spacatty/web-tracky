"use client";

import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  chartPresets,
  clampWindow,
  presetLabel,
  windowFor,
  withDate,
  withTime,
  type ChartPreset,
  type ChartPresetId,
  type ChartWindow,
} from "@/lib/range";

export function useChartRange(initial: ChartPreset = "24h") {
  const [preset, setPreset] = useState<ChartPresetId>(initial);
  const [custom, setCustom] = useState<{ from: Date; to: Date } | null>(null);
  const window: ChartWindow =
    preset === "custom" && custom ? { preset: "custom", from: custom.from, to: custom.to } : windowFor(preset === "custom" ? initial : preset);

  function selectPreset(next: string) {
    if (!chartPresets.some((item) => item.id === next)) return;
    setPreset(next as ChartPreset);
    setCustom(null);
  }

  function selectFrom(next: Date) {
    const updated = clampWindow(next, window.to, "from");
    setPreset("custom");
    setCustom({ from: updated.from, to: updated.to });
  }

  function selectTo(next: Date) {
    const updated = clampWindow(window.from, next, "to");
    setPreset("custom");
    setCustom({ from: updated.from, to: updated.to });
  }

  return { preset: window.preset, from: window.from, to: window.to, window, selectPreset, selectFrom, selectTo };
}

export function ChartRangePicker({
  preset,
  from,
  to,
  onPreset,
  onFrom,
  onTo,
}: {
  preset: ChartPresetId;
  from: Date;
  to: Date;
  onPreset: (preset: string) => void;
  onFrom: (value: Date) => void;
  onTo: (value: Date) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={preset} onValueChange={(value) => value && onPreset(value)}>
        <SelectTrigger size="sm" className="w-[9.25rem]" aria-label="Chart range">
          <SelectValue>{presetLabel(preset)}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start">
          {chartPresets.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.id === "today" ? "Today · UTC" : item.label}
            </SelectItem>
          ))}
          {preset === "custom" ? <SelectItem value="custom">Custom</SelectItem> : null}
        </SelectContent>
      </Select>
      <DateTimeField label="From" value={from} onChange={onFrom} />
      <DateTimeField label="To" value={to} onChange={onTo} />
    </div>
  );
}

function DateTimeField({ label, value, onChange }: { label: string; value: Date; onChange: (value: Date) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" className="min-w-[10.5rem] justify-start px-2 font-normal" />}
      >
        <CalendarIcon />
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-xs">{format(value, "MMM d, HH:mm")}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-0 p-0">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(day) => {
            if (day) onChange(withDate(value, day));
          }}
          disabled={{ after: new Date() }}
        />
        <div className="space-y-1.5 border-t px-3 py-2.5">
          <Label className="text-xs text-muted-foreground">Time</Label>
          <Input
            type="time"
            step={60}
            value={format(value, "HH:mm")}
            onChange={(event) => onChange(withTime(value, event.target.value))}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
