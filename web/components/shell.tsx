"use client";

import {
  ActivityIcon,
  BookmarkIcon,
  ChevronsUpDownIcon,
  KeyRoundIcon,
  LayersIcon,
  ListChecksIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  RadarIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";

type NavItem = { href: string; label: string; icon: LucideIcon };

const watch: NavItem[] = [
  { href: "/monitors", label: "Monitors", icon: ActivityIcon },
  { href: "/check", label: "Probe", icon: ListChecksIcon },
  { href: "/presets", label: "Presets", icon: BookmarkIcon },
];

const fleet: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/nodes", label: "Nodes", icon: RadarIcon },
  { href: "/groups", label: "Pools", icon: LayersIcon },
];

const admin: NavItem[] = [
  { href: "/enroll", label: "Enroll", icon: KeyRoundIcon },
  { href: "/users", label: "Users", icon: UsersIcon },
];

export function Shell({
  user,
  defaultSidebarOpen = true,
  children,
}: {
  user: Me;
  defaultSidebarOpen?: boolean;
  children: React.ReactNode;
}) {
  const groups = [
    { label: "Checks", items: watch },
    { label: "Fleet", items: fleet },
    ...(user.role === "admin" ? [{ label: "Admin", items: admin }] : []),
  ];

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip="Tracky" render={<Link href="/monitors" />}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
                  T
                </span>
                <span className="font-semibold tracking-tight">Tracky</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {groups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <NavLink key={item.href} item={item} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <AccountMenu user={user} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur">
          <SidebarTrigger />
        </header>
        <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={item.label}
        render={<Link href={item.href} onClick={() => setOpenMobile(false)} />}
      >
        <Icon />
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function AccountMenu({ user }: { user: Me }) {
  const { isMobile, state } = useSidebar();
  const router = useRouter();
  const initial = user.email.trim().charAt(0).toUpperCase() || "T";

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              />
            }
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-xs font-medium text-sidebar-primary-foreground">
              {initial}
            </span>
            <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-medium">{user.email}</span>
              <span className="truncate text-xs text-muted-foreground capitalize">{user.role}</span>
            </span>
            <ChevronsUpDownIcon className="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-56! min-w-56"
            side={isMobile ? "top" : state === "collapsed" ? "right" : "top"}
            align="end"
            sideOffset={8}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal">
                <span className="block truncate text-sm font-medium text-foreground">{user.email}</span>
                <span className="block capitalize">{user.role}</span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/settings" />}>
              <SettingsIcon />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
