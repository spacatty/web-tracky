import { cookies } from "next/headers";

import type { Me } from "@/lib/types";

export function internalApiBase() {
  if (process.env.API_INTERNAL_URL) return process.env.API_INTERNAL_URL;
  return `http://127.0.0.1:${process.env.API_PORT || "8080"}`;
}

export async function getMe(): Promise<Me | null> {
  try {
    const jar = await cookies();
    const res = await fetch(`${internalApiBase()}/api/auth/me`, {
      headers: { cookie: jar.toString() },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as Me;
  } catch {
    return null;
  }
}
