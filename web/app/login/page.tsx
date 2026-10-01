import { redirect } from "next/navigation";

import { AuthForm } from "@/app/login/login-form";
import { getMe } from "@/lib/session";

export default async function LoginPage() {
  if (await getMe()) redirect("/");
  return <AuthForm mode="login" registrationOpen={process.env.AUTH_REGISTRATION === "open"} />;
}
