"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/actions/auth";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result = await requestPasswordReset({ email });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setSent(true);
    });
  }

  if (sent) {
    return (
      <div className="space-y-3 rounded-md border bg-muted/30 p-4 text-sm">
        <p className="font-medium">Lien envoyé.</p>
        <p className="text-muted-foreground">
          Si un compte existe pour <span className="font-mono">{email}</span>, tu vas recevoir un
          e-mail avec un lien de réinitialisation. Vérifie aussi tes spams.
        </p>
      </div>
    );
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

      <Button type="submit" className="w-full" disabled={pending || !email}>
        {pending ? "Envoi…" : "Envoyer le lien"}
      </Button>
    </form>
  );
}
