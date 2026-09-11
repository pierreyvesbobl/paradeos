"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithPassword } from "@/lib/actions/auth";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Connexion par e-mail + mot de passe uniquement. Il n'y a pas
 * d'inscription publique : les comptes sont créés par un administrateur
 * depuis Réglages > Utilisateurs (invitation par e-mail). Outil interne,
 * toute personne connectée voit l'intégralité des données.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `next` porte la destination d'origine (ex. l'écran de consentement
  // OAuth avec ses paramètres). On ne suit qu'un chemin relatif à cette
  // origine — "//autre-site" serait une redirection ouverte.
  const rawNext = searchParams.get("next");
  const next = rawNext?.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result = await signInWithPassword({ email, password });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Connecté.");
      router.push(next as Route);
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
        <div className="flex items-baseline justify-between">
          <Label htmlFor="password">Mot de passe</Label>
          <Link
            href="/login/forgot"
            className="text-muted-foreground text-xs underline-offset-4 hover:underline"
          >
            Oublié ?
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending || !email || !password}>
        {pending ? "Connexion…" : "Se connecter"}
      </Button>

      <p className="text-center text-muted-foreground text-xs">
        Pas de compte ? Demande une invitation à un administrateur.
      </p>
    </form>
  );
}
