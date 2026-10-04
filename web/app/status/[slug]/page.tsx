"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { LockIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import { MonitorPanel } from "@/components/monitor-panel";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatInterval } from "@/lib/format";
import { successLabel } from "@/lib/success";
import type { MonitorDetail } from "@/lib/types";

const storageKey = (slug: string) => `tracky-status-token:${slug}`;

const terminal = (error: unknown) => error instanceof ApiError && (error.status === 401 || error.status === 404);

export default function PublicStatusPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [token, setToken] = useState<string | null>(() => (typeof window === "undefined" ? null : window.sessionStorage.getItem(storageKey(slug))));

  const headers = useMemo(() => (token ? { "X-Status-Token": token } : undefined), [token]);
  const query = useQuery({
    queryKey: ["public", slug, token],
    queryFn: () => api<MonitorDetail>(`/api/public/status/${slug}`, { headers }),
    refetchInterval: (state) => (terminal(state.state.error) ? false : 4000),
    retry: (count, error) => !terminal(error) && count < 2,
  });
  const locked = query.error instanceof ApiError && query.error.status === 401;
  const monitor = query.data;

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-10">
      <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Status</p>
      {locked ? (
        <Unlock
          slug={slug}
          onUnlocked={(next) => {
            window.sessionStorage.setItem(storageKey(slug), next);
            setToken(next);
          }}
        />
      ) : !monitor ? (
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{query.isError ? "This status page is not available." : "Loading…"}</h1>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="mt-1 flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{monitor.name}</h1>
                {monitor.enabled ? <StatusPill status={monitor.last_status} /> : <StatusPill status="unknown" label="paused" />}
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{monitor.target_url}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Every {formatInterval(monitor.interval_sec)} · Success {successLabel(monitor.template_name, monitor.success_rules)}
              </p>
            </div>
          </div>
          <MonitorPanel monitor={monitor} run={monitor.latest_run} seriesPath={`/api/public/status/${slug}/series`} headers={headers} />
        </div>
      )}
    </main>
  );
}

function Unlock({ slug, onUnlocked }: { slug: string; onUnlocked: (token: string) => void }) {
  const [password, setPassword] = useState("");
  const unlock = useMutation({
    mutationFn: () => api<{ token: string }>(`/api/public/status/${slug}/unlock`, { method: "POST", body: JSON.stringify({ password }) }),
    onSuccess: (result) => onUnlocked(result.token),
  });
  return (
    <Card className="mx-auto mt-10 max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LockIcon className="size-4" />
          Password required
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            unlock.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">This status page is protected. Enter the password you were given.</p>
          <Input type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" required />
          {unlock.isError ? <p className="text-xs text-destructive">{errorMessage(unlock.error, "Could not unlock")}</p> : null}
          <Button type="submit" className="w-full" disabled={unlock.isPending || !password}>
            View status
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
