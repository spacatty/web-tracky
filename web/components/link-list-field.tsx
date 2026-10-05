"use client";

import { UploadIcon, XIcon } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function LinkListField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const count = countLines(value);
  return (
    <div className="space-y-2">
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn("h-48 resize-none overflow-y-auto font-mono text-xs leading-relaxed [field-sizing:fixed] md:text-xs", className)}
        spellCheck={false}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
            <UploadIcon />
            Upload text file
          </Button>
          {value ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")} className="text-muted-foreground">
              <XIcon />
              Clear
            </Button>
          ) : null}
        </div>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {count} {count === 1 ? "link" : "links"}
        </span>
      </div>
      <input
        ref={input}
        type="file"
        accept=".txt,.csv,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (file.size > 1_000_000) {
            toast.error("File is larger than 1 MB");
            return;
          }
          void file.text().then((text) => {
            onChange(value.trim() ? `${value.trim()}\n${text.trim()}` : text);
          });
        }}
      />
    </div>
  );
}

export function countLines(text: string) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .flatMap((line) => line.split(",").filter((part) => part.trim() !== "")).length;
}
