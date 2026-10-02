import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Shell } from "@/components/shell";
import { getMe } from "@/lib/session";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/login");
  const jar = await cookies();
  const sidebarOpen = jar.get("sidebar_state")?.value !== "false";
  return (
    <Shell user={me} defaultSidebarOpen={sidebarOpen}>
      {children}
    </Shell>
  );
}
