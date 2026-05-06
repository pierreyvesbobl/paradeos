"use client";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { updateProfile } from "@/lib/actions/profile";
import { scrollToFirstError } from "@/lib/forms/scroll-to-error";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Props = {
  defaultValues: { fullName: string; costRateHourly: string };
};

export function ProfileForm({ defaultValues }: Props) {
  const [fullName, setFullName] = useState(defaultValues.fullName);
  const [costRateHourly, setCostRateHourly] = useState(defaultValues.costRateHourly);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await updateProfile({
        fullName,
        costRateHourly: costRateHourly || undefined,
      });
      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        scrollToFirstError(result.fieldErrors);
        toast.error(result.message);
        return;
      }
      toast.success("Profil mis à jour.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 rounded-lg border bg-card p-6">
      <div className="space-y-2">
        <Label htmlFor="fullName">Nom complet</Label>
        <Input
          id="fullName"
          required
          minLength={2}
          maxLength={120}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          disabled={pending}
        />
        <FieldError messages={errors.fullName} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="costRateHourly">Taux de coût horaire (HT/h)</Label>
        <MoneyInput
          id="costRateHourly"
          value={costRateHourly}
          onValueChange={setCostRateHourly}
          placeholder="80"
          disabled={pending}
        />
        <p className="text-muted-foreground text-xs">
          Utilisé pour calculer le coût interne et la marge des projets. Visible uniquement dans les
          agrégats — pas affiché sur ta fiche publique.
        </p>
        <FieldError messages={errors.costRateHourly} />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer"}
      </Button>
    </form>
  );
}
