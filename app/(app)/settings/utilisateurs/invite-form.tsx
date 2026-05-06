"use client";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inviteUser } from "@/lib/actions/users";
import { scrollToFirstError } from "@/lib/forms/scroll-to-error";
import { type UserRoleValue, userRoleEnum, userRoleLabels } from "@/lib/schemas/users";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRoleValue>("member");
  const [costRateHourly, setCostRateHourly] = useState("");
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const res = await inviteUser({
        email,
        fullName,
        role,
        costRateHourly: costRateHourly || undefined,
      });
      if (!res.ok) {
        if (res.fieldErrors) setErrors(res.fieldErrors);
        scrollToFirstError(res.fieldErrors);
        toast.error(res.message);
        return;
      }
      toast.success(`Invitation envoyée à ${email}.`);
      setEmail("");
      setFullName("");
      setRole("member");
      setCostRateHourly("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-card p-6">
      <div className="space-y-1">
        <h2 className="font-medium text-sm">Inviter un utilisateur</h2>
        <p className="text-muted-foreground text-xs">
          Un magic link sera envoyé à l'adresse fournie. La personne pourra ensuite définir un mot
          de passe depuis son profil.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="invite-email">E-mail</Label>
          <Input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
            placeholder="prenom.nom@parade-os.com"
          />
          <FieldError messages={errors.email} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="invite-name">Nom complet</Label>
          <Input
            id="invite-name"
            required
            minLength={2}
            maxLength={120}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={pending}
            placeholder="Bénilde Dupont"
          />
          <FieldError messages={errors.fullName} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="invite-role">Rôle</Label>
          <Select
            value={role}
            onValueChange={(v) => setRole(v as UserRoleValue)}
            disabled={pending}
          >
            <SelectTrigger id="invite-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {userRoleEnum.options.map((r) => (
                <SelectItem key={r} value={r}>
                  {userRoleLabels[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="invite-cost">Taux horaire (HT/h)</Label>
          <MoneyInput
            id="invite-cost"
            value={costRateHourly}
            onValueChange={setCostRateHourly}
            disabled={pending}
            placeholder="80"
          />
          <FieldError messages={errors.costRateHourly} />
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Envoi…" : "Envoyer l'invitation"}
      </Button>
    </form>
  );
}
