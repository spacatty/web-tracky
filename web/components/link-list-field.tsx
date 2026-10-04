"use client";

import { UploadIcon } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function LinkListField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <Textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-h-40 font-mono text-xs" spellCheck={false} />
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
          <UploadIcon />
          Upload text file
        </Button>
        <span className="text-xs text-muted-foreground">{countLines(value)} lines</span>
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

function countLines(text: string) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#")).length;
}
