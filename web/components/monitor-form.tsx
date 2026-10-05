"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, LockIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { FolderSelect } from "@/components/folder-ui";
import { GroupChecks } from "@/components/group-checks";
import { PresetSelect, useStatusTemplates } from "@/components/preset-select";
import { SuccessRulesField } from "@/components/success-rules";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { copyText, shareURL } from "@/lib/clipboard";
import { formatInterval, intervalStops } from "@/lib/format";
import { blankRule, compileRules, toDraft, type DraftRule } from "@/lib/success";
import type { Me, Monitor, PublicConfig, SuccessRule } from "@/lib/types";

type PasswordMode = "keep" | "set" | "clear";

export function MonitorDialog({
  open,
  onOpenChange,
  monitor,
  defaultFolderId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monitor?: Monitor | null;
  defaultFolderId?: string;
  onSaved: (monitor: Monitor) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
        {open ? (
          <MonitorForm
            key={monitor?.id ?? `new-${defaultFolderId ?? ""}`}
            monitor={monitor ?? null}
            defaultFolderId={defaultFolderId}
            onSaved={onSaved}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MonitorForm({
  monitor,
  defaultFolderId,
  onSaved,
  onClose,
}: {
  monitor: Monitor | null;
  defaultFolderId?: string;
  onSaved: (monitor: Monitor) => void;
  onClose: () => void;
}) {
  const editing = Boolean(monitor);
  const client = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/auth/me") });
  const [folderID, setFolderID] = useState(monitor ? (monitor.folder_id ?? "") : (defaultFolderId ?? ""));
  const config = useQuery({ queryKey: ["config"], queryFn: () => api<PublicConfig>("/api/config") });
  const templates = useStatusTemplates();
  const base = intervalStops(config.data?.min_interval_sec ?? 30);
  const stops = monitor && !base.includes(monitor.interval_sec) ? [...base, monitor.interval_sec].sort((a, b) => a - b) : base;
  const draft = toDraft(monitor?.success_rules);
  const initialPreset = monitor?.template_id ? monitor.template_id : draft.enabled ? "custom" : "default";
  const [name, setName] = useState(monitor?.name ?? "");
  const [url, setUrl] = useState(monitor?.target_url ?? "https://");
  const [interval, setIntervalSec] = useState(monitor?.interval_sec ?? 60);
  const [maxNodes, setMaxNodes] = useState(monitor?.max_nodes ?? 20);
  const [countries, setCountries] = useState(monitor?.country_codes.join(", ") ?? "");
  const [enabled, setEnabled] = useState(monitor?.enabled ?? true);
  const [share, setShare] = useState(monitor?.public_enabled ?? false);
  const [groupIDs, setGroupIDs] = useState<string[]>(monitor?.groups.map((group) => group.id) ?? []);
  const [preset, setPreset] = useState(initialPreset);
  const [successRules, setSuccessRules] = useState<DraftRule[]>(draft.rules.length ? draft.rules : [blankRule()]);
  const protectedNow = monitor?.public_protected ?? false;
  const [passwordMode, setPasswordMode] = useState<PasswordMode>(protectedNow ? "keep" : "set");
  const [password, setPassword] = useState("");
  const index = stops.reduce((best, stop, i) => (Math.abs(stop - interval) < Math.abs(stops[best] - interval) ? i : best), 0);
  const intervalSec = stops[index] ?? interval;

  const save = useMutation({
    mutationFn: () => {
      let templateID = "";
      let rulesPayload: SuccessRule[] = [];
      if (preset === "custom") {
        const compiled = compileRules(true, successRules);
        if (!compiled.ok) return Promise.reject(new Error(compiled.error));
        rulesPayload = compiled.rules;
      } else if (preset !== "default") {
        templateID = preset;
      }
      const payload: Record<string, unknown> = {
        name,
        target_url: url,
        interval_sec: intervalSec,
        enabled,
        public_enabled: share,
        country_codes: countries.split(/[,\s]+/).filter(Boolean),
        max_nodes: maxNodes,
        group_ids: groupIDs,
        success_rules: rulesPayload,
        template_id: templateID,
        folder_id: folderID,
      };
      if (passwordMode === "clear") payload.public_password = "";
      if (passwordMode === "set" && password) payload.public_password = password;
      if (passwordMode === "set" && !password && editing && protectedNow) payload.public_password = "";
      return editing
        ? api<Monitor>(`/api/monitors/${monitor?.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : api<Monitor>("/api/monitors", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: ["monitor-folders"] });
      toast.success(editing ? "Monitor updated" : "Monitor created");
      onClose();
      onSaved(saved);
    },
    onError: (error) => toast.error(errorMessage(error, editing ? "Could not save monitor" : "Could not create monitor")),
  });

  const link = monitor?.public_slug ? shareURL(monitor.public_slug) : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit monitor" : "Track a website"}</DialogTitle>
        {editing ? <DialogDescription>Changes apply from the next scheduled check.</DialogDescription> : null}
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input value={name} onChange={(event) => setName(event.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>URL</Label>
          <Input value={url} onChange={(event) => setUrl(event.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Group</Label>
          <FolderSelect value={folderID} ownerId={monitor?.owner_id ?? me.data?.id} onChange={(id) => setFolderID(id)} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <Label>Interval</Label>
            <span className="font-mono text-xs">{formatInterval(intervalSec)}</span>
          </div>
          <Slider
            min={0}
            max={Math.max(stops.length - 1, 1)}
            step={1}
            value={[index]}
            onValueChange={(value) => {
              const next = Array.isArray(value) ? value[0] : value;
              setIntervalSec(stops[Math.min(next, stops.length - 1)] ?? interval);
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Max nodes</Label>
            <Input type="number" min={1} max={100} value={maxNodes} onChange={(event) => setMaxNodes(Number(event.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Countries</Label>
            <Input value={countries} onChange={(event) => setCountries(event.target.value)} placeholder="DE, US" />
          </div>
        </div>
        <GroupChecks ids={groupIDs} onChange={setGroupIDs} defaultPrivate={!monitor} />
        <PresetSelect
          value={preset}
          fallbackName={monitor?.template_name}
          includeCustom
          onChange={(next) => {
            if (next === "custom" && preset !== "default" && preset !== "custom") {
              const source = templates.data?.find((template) => template.id === preset)?.success_rules;
              if (source && source.length > 0) setSuccessRules(toDraft(source).rules);
            }
            if (next === "custom" && successRules.length === 0) setSuccessRules([blankRule()]);
            setPreset(next);
          }}
        />
        {preset !== "default" && preset !== "custom" ? (
          <p className="text-xs text-muted-foreground">This monitor keeps a copy of the preset. Editing the preset later does not change it until you save again.</p>
        ) : null}
        {preset === "custom" ? (
          <SuccessRulesField required enabled label="Match" rules={successRules} onEnabledChange={() => undefined} onChange={setSuccessRules} />
        ) : null}
        <Separator />
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>Checks running</Label>
            <p className="text-xs text-muted-foreground">Turn off to pause scheduled checks without losing history.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Public status page</Label>
              <p className="text-xs text-muted-foreground">Anyone with the link can see uptime and latency.</p>
            </div>
            <Switch checked={share} onCheckedChange={setShare} />
          </div>
          {share && link && monitor?.public_enabled ? (
            <div className="flex items-center gap-2">
              <Input readOnly value={link} className="font-mono text-xs" onFocus={(event) => event.target.select()} />
              <Button type="button" variant="outline" size="icon" title="Copy link" onClick={() => copyText(link, "Link copied")}>
                <CopyIcon />
              </Button>
            </div>
          ) : null}
          {share ? (
            <div className="space-y-2">
              {protectedNow && passwordMode === "keep" ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    <LockIcon className="size-3.5" />
                    Password protected
                  </span>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setPasswordMode("set")}>
                      Change password
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => setPasswordMode("clear")}>
                      Remove
                    </Button>
                  </div>
                </div>
              ) : null}
              {passwordMode === "clear" ? (
                <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                  <span>The password will be removed on save.</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPasswordMode("keep")}>
                    Undo
                  </Button>
                </div>
              ) : null}
              {passwordMode === "set" ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>{protectedNow ? "New password" : "Password (optional)"}</Label>
                    {protectedNow ? (
                      <Button type="button" variant="ghost" size="xs" onClick={() => setPasswordMode("keep")}>
                        Keep current
                      </Button>
                    ) : null}
                  </div>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    minLength={password ? 4 : undefined}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={protectedNow ? "Leave empty to remove the password" : "Leave empty for an open page"}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="submit" disabled={save.isPending}>
            {editing ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
