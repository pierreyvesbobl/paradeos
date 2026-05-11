import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm space-y-8 rounded-lg border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <Link href="/" className="inline-block font-medium font-mono text-sm tracking-tight">
            Parade OS
          </Link>
          <h1 className="font-semibold text-2xl tracking-tight">Mot de passe oublié</h1>
          <p className="text-muted-foreground text-sm">
            Entre ton e-mail, on t'envoie un lien pour le réinitialiser.
          </p>
        </div>
        <ForgotPasswordForm />
        <p className="text-center text-muted-foreground text-xs">
          <Link href="/login" className="underline-offset-4 hover:underline">
            Retour à la connexion
          </Link>
        </p>
      </div>
    </main>
  );
}
