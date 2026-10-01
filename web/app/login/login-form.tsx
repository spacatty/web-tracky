"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";

export function AuthForm({ mode, registrationOpen }: { mode: "login" | "register"; registrationOpen: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const register = mode === "register";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await api(register ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      router.push("/");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not sign in");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 grid size-8 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">T</div>
          <CardTitle>{register ? "Create an account" : "Sign in to Tracky"}</CardTitle>
          <CardDescription>
            {register ? "Use the public node pools your admin has opened." : "Checks run from machines you enroll."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete={register ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Working…" : register ? "Create account" : "Sign in"}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            {register ? (
              <Link href="/login" className="underline-offset-4 hover:underline">Already have an account</Link>
            ) : registrationOpen ? (
              <Link href="/register" className="underline-offset-4 hover:underline">Create an account</Link>
            ) : (
              "Registration is closed. Ask an admin for an account."
            )}
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
