import { requireUser } from "@/lib/auth/server";
import Link from "next/link";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * Page atteinte après que l'user a cliqué sur le lien dans son e-mail
 * et que `/auth/confirm` a validé l'OTP de recovery. À ce stade, l'user
 * est authentifié temporairement (session recovery Supabase) et peut
 * appeler `setPassword`.
 *
 * Si quelqu'un atterrit ici sans session, `requireUser` redirige vers /login.
 */
export default async function ResetPasswordPage() {
  await requireUser();

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm space-y-8 rounded-lg border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <Link href="/" className="inline-block font-medium font-mono text-sm tracking-tight">
            Parade OS
          </Link>
          <h1 className="font-semibold text-2xl tracking-tight">Nouveau mot de passe</h1>
          <p className="text-muted-foreground text-sm">
            Choisis un mot de passe (8 caractères minimum).
          </p>
        </div>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
