"use client";

import { ActivityIcon, KeyRoundIcon, LayersIcon, LogOutIcon, MenuIcon, RadarIcon, SettingsIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import { cn } from "cn";

const links = [
  { href: "/", label: "Overview", icon: ActivityIcon },
  { href: "/nodes", label: "Nodes", icon: RadarIcon },
  { href: "/groups", label: "Groups", icon: LayersIcon },
  { href: "/monitors", label: "Monitors", icon: ActivityIcon },
];

export function Shell({ user, children }: { user: Me; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const items = [
    ...links,
    ...(user.role === "admin"
      ? [
          { href: "/enroll", label: "Enroll", icon: KeyRoundIcon },
          { href: "/users", label: "Users", icon: UsersIcon },
        ]
      : []),
    { href: "/settings", label: "Settings", icon: SettingsIcon },
  ];

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              active && "bg-accent font-medium text-accent-foreground",
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="hidden border-r bg-sidebar md:flex md:flex-col md:px-3 md:py-4">
        <Link href="/" className="mb-6 flex items-center gap-2 px-2">
          <span className="grid size-7 place-items-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">T</span>
          <span className="font-semibold tracking-tight">Tracky</span>
        </Link>
        {nav}
        <div className="mt-auto space-y-3 px-2 pt-6">
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          <Button variant="outline" size="sm" className="w-full" onClick={logout}>
            <LogOutIcon />
            Sign out
          </Button>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex items-center gap-3 border-b bg-sidebar px-4 py-3 md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger render={<Button variant="outline" size="icon-sm" aria-label="Menu" />}>
              <MenuIcon />
            </SheetTrigger>
            <SheetContent side="left" className="w-64">
              <SheetHeader>
                <SheetTitle>Tracky</SheetTitle>
              </SheetHeader>
              {nav}
            </SheetContent>
          </Sheet>
          <span className="font-semibold tracking-tight">Tracky</span>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
