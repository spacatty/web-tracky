import { redirect } from "next/navigation";

import { Shell } from "@/components/shell";
import { getMe } from "@/lib/session";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect("/login");
  return <Shell user={me}>{children}</Shell>;
}
