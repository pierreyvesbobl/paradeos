"use client";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setPassword } from "@/lib/actions/auth";
import { scrollToFirstError } from "@/lib/forms/scroll-to-error";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export function PasswordForm() {
  const [password, setPasswordValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    if (password !== confirm) {
      toast.error("Les mots de passe ne correspondent pas.");
      return;
    }
    startTransition(async () => {
      const result = await setPassword({ password });
      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        scrollToFirstError(result.fieldErrors);
        toast.error(result.message);
        return;
      }
      toast.success("Mot de passe enregistré.");
      setPasswordValue("");
      setConfirm("");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-card p-6">
      <div className="space-y-1">
        <h2 className="font-medium text-sm">Mot de passe</h2>
        <p className="text-muted-foreground text-xs">
          Permet de te connecter sans passer par un magic link. Min 8 caractères.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Nouveau mot de passe</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
          value={password}
          onChange={(e) => setPasswordValue(e.target.value)}
          disabled={pending}
        />
        <FieldError messages={errors.password} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm">Confirmer</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={pending}
        />
      </div>

      <Button type="submit" disabled={pending || !password || password !== confirm}>
        {pending ? "Enregistrement…" : "Définir le mot de passe"}
      </Button>
    </form>
  );
}
