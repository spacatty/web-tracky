"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { formatAgo } from "@/lib/format";
import type { EnrollToken, Group, PublicConfig } from "@/lib/types";

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
  const [created, setCreated] = useState<EnrollToken | null>(null);
  const defaultURL = config.data?.agent_url ?? "";
  const shownURL = agentURL || defaultURL;

  const create = useMutation({
    mutationFn: () =>
      api<EnrollToken>("/api/enroll-tokens", {
        method: "POST",
        body: JSON.stringify({ name, group_ids: groupIDs, expires_hours: hours, max_uses: uses }),
      }),
    onSuccess: (token) => {
      setCreated(token);
      client.invalidateQueries({ queryKey: ["tokens"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not create token"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/enroll-tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["tokens"] }),
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not revoke"),
  });

  const command = created?.token
    ? `curl -fsSL "${shownURL.replace(/\/$/, "")}/install.sh?token=${encodeURIComponent(created.token)}&endpoint=${encodeURIComponent(shownURL.replace(/\/$/, ""))}" | bash`
    : "";

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Install</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Enroll a machine</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">Linux only. The command installs a systemd agent that phones home to the URL below.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>New token</CardTitle></CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} required />
              </div>
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
                    onCheckedChange={(checked) =>
                      setGroupIDs((current) => (checked ? [...current, group.id] : current.filter((id) => id !== group.id)))
                    }
                  />
                  {group.name}
                </Label>
              ))}
            </div>
            <Button type="submit" disabled={create.isPending}>Create token</Button>
          </form>
          {created?.token ? (
            <div className="mt-5 space-y-2">
              <Label>Agent URL</Label>
              <Input value={shownURL} onChange={(event) => setAgentURL(event.target.value)} />
              <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">{command}</pre>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(command);
                    toast.success("Command copied");
                  } catch {
                    toast.error("Could not copy the command");
                  }
                }}
              >
                Copy command
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Tokens</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(tokens.data ?? []).map((token) => (
            <div key={token.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{token.name}</div>
                <div className="text-xs text-muted-foreground">
                  {token.uses}/{token.max_uses} uses · {token.expires_at ? `expires ${formatAgo(token.expires_at)}` : "no expiry"} · {formatAgo(token.created_at)}
                </div>
                <div className="mt-1 flex gap-1">
                  {token.groups.map((group) => <Badge key={group.id} variant="secondary">{group.name}</Badge>)}
                </div>
              </div>
              {token.revoked ? <Badge variant="outline">revoked</Badge> : <Button variant="outline" size="sm" onClick={() => revoke.mutate(token.id)}>Revoke</Button>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
