"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import type { Me } from "@/lib/types";

export default function SettingsPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/auth/me") });
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const profile = mounted ? me.data : undefined;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      }),
    onSuccess: () => {
      toast.success("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Could not update password"),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    save.mutate();
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Account</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Settings</h1>
      </div>
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>{profile?.email ?? "Signed-in account"}</CardDescription>
        </CardHeader>
        <CardContent>
          {profile ? <Badge variant="secondary">{profile.role}</Badge> : null}
        </CardContent>
      </Card>
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Use 8–200 characters. You stay signed in on this device.</CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={200}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={200}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Update password"}
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
