import Link from "next/link";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm space-y-8 rounded-lg border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <Link href="/" className="inline-block font-medium font-mono text-sm tracking-tight">
            Parade OS
          </Link>
          <h1 className="font-semibold text-2xl tracking-tight">Connexion</h1>
          <p className="text-muted-foreground text-sm">Reçois un lien magique par e-mail.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
