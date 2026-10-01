import { redirect } from "next/navigation";

import { AuthForm } from "@/app/login/login-form";
import { getMe } from "@/lib/session";

export default async function RegisterPage() {
  if (await getMe()) redirect("/");
  if (process.env.AUTH_REGISTRATION !== "open") {
    return (
      <main className="grid min-h-screen place-items-center px-4 text-center">
        <div className="max-w-sm space-y-2">
          <h1 className="text-lg font-semibold">Registration is closed</h1>
          <p className="text-sm text-muted-foreground">An admin can create an account for you, or set AUTH_REGISTRATION=open.</p>
        </div>
      </main>
    );
  }
  return <AuthForm mode="register" registrationOpen />;
}
