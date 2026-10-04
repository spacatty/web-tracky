"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, CopyIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { formatAgo } from "@/lib/format";
import type { EnrollToken, Group, PublicConfig } from "@/lib/types";

function installCommand(agentURL: string, token: string) {
  const base = agentURL.replace(/\/$/, "");
  return `curl -fsSL "${base}/install.sh?token=${encodeURIComponent(token)}&endpoint=${encodeURIComponent(base)}" | bash`;
}

function tokenState(token: EnrollToken) {
  if (token.revoked) return "revoked";
  if (token.expires_at && new Date(token.expires_at).getTime() < Date.now()) return "expired";
  if (token.max_uses > 0 && token.uses >= token.max_uses) return "used up";
  return "active";
}

export default function EnrollPage() {
  const client = useQueryClient();
  const config = useQuery({ queryKey: ["config"], queryFn: () => api<PublicConfig>("/api/config") });
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => api<Group[]>("/api/groups") });
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => api<EnrollToken[]>("/api/enroll-tokens") });
  const [name, setName] = useState("laptop");
  const [hours, setHours] = useState(24);
  const [uses, setUses] = useState(1);
  const [groupIDs, setGroupIDs] = useState<string[]>([]);
  const [agentURL, setAgentURL] = useState("");
  const [openID, setOpenID] = useState<string | null>(null);
  const shownURL = agentURL || config.data?.agent_url || "";

  const create = useMutation({
    mutationFn: () =>
      api<EnrollToken>("/api/enroll-tokens", {
        method: "POST",
        body: JSON.stringify({ name, group_ids: groupIDs, expires_hours: hours, max_uses: uses }),
      }),
    onSuccess: (token) => {
      setOpenID(token.id);
      toast.success("Token created");
      client.invalidateQueries({ queryKey: ["tokens"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not create token"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/enroll-tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["tokens"] }),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not revoke"),
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Install</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Enroll a machine</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">Linux only. The command installs a systemd agent that phones home to the agent URL.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>New token</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Expires in hours</Label>
                  <Input type="number" min={0} value={hours} onChange={(event) => setHours(Number(event.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Max uses</Label>
                  <Input type="number" min={1} value={uses} onChange={(event) => setUses(Number(event.target.value))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Groups</Label>
                {(groups.data ?? []).map((group) => (
                  <Label key={group.id} className="font-normal">
                    <Checkbox
                      checked={groupIDs.includes(group.id)}
                      onCheckedChange={(checked) => setGroupIDs((current) => (checked ? [...current, group.id] : current.filter((id) => id !== group.id)))}
                    />
                    {group.name}
                  </Label>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label>Agent URL</Label>
                <Input value={shownURL} onChange={(event) => setAgentURL(event.target.value)} className="font-mono text-xs" />
                <p className="text-[11px] text-muted-foreground">Used in every install command on this page.</p>
              </div>
              <Button type="submit" disabled={create.isPending}>Create token</Button>
            </form>
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Tokens</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {tokens.data?.length === 0 ? <p className="text-sm text-muted-foreground">No tokens yet. Create one to get an install command.</p> : null}
            {(tokens.data ?? []).map((token) => {
              const state = tokenState(token);
              const usable = state === "active";
              const command = token.token ? installCommand(shownURL, token.token) : "";
              const open = openID === token.id;
              return (
                <div key={token.id} className={`rounded-lg border px-3 py-2.5 text-sm ${usable ? "" : "opacity-70"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{token.name}</span>
                        <Badge variant={usable ? "secondary" : "outline"}>{state}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {token.uses}/{token.max_uses} uses · {token.expires_at ? `expires ${formatAgo(token.expires_at)}` : "no expiry"} · created {formatAgo(token.created_at)}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {token.groups.map((group) => (
                          <Badge key={group.id} variant="secondary">{group.name}</Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {usable && command ? (
                        <>
                          <Button variant="outline" size="sm" onClick={() => setOpenID(open ? null : token.id)}>
                            <TerminalIcon />
                            Command
                            <ChevronDownIcon className={open ? "rotate-180 transition-transform" : "transition-transform"} />
                          </Button>
                          <Button variant="outline" size="icon-sm" title="Copy install command" onClick={() => copyText(command, "Command copied")}>
                            <CopyIcon />
                          </Button>
                        </>
                      ) : null}
                      {token.revoked ? null : (
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => revoke.mutate(token.id)}>
                          Revoke
                        </Button>
                      )}
                    </div>
                  </div>
                  {usable && !command ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">This token was created before commands were stored. Create a new token to get a copyable command.</p>
                  ) : null}
                  {usable && command && open ? (
                    <pre className="mt-2 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">{command}</pre>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
