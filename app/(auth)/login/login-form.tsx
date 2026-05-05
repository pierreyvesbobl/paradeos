"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithPassword, signUpWithPassword } from "@/lib/actions/auth";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Mode = "signin" | "signup";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result =
        mode === "signin"
          ? await signInWithPassword({ email, password })
          : await signUpWithPassword({ email, password });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(mode === "signin" ? "Connecté." : "Compte créé.");
      router.push("/");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="prenom@parade.fr"
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Mot de passe</Label>
        <Input
          id="password"
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          required
          minLength={mode === "signup" ? 8 : 1}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
        />
        {mode === "signup" ? (
          <p className="text-muted-foreground text-xs">8 caractères minimum.</p>
        ) : null}
      </div>

      <Button type="submit" className="w-full" disabled={pending || !email || !password}>
        {pending
          ? mode === "signin"
            ? "Connexion…"
            : "Création…"
          : mode === "signin"
            ? "Se connecter"
            : "Créer mon compte"}
      </Button>

      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="block w-full text-center text-muted-foreground text-xs underline-offset-4 hover:underline"
      >
        {mode === "signin" ? "Créer un compte" : "J'ai déjà un compte — me connecter"}
      </button>
    </form>
  );
}
