"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createContact, updateContact } from "@/lib/actions/contacts";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type EntityOption = { id: string; name: string };

type Props = {
  mode: "create" | "edit";
  entities: EntityOption[];
  defaultValues: {
    id?: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    jobTitle: string;
    linkedinUrl: string;
    entityId: string;
    notes: string;
  };
};

const NONE_VALUE = "__none__";

export function ContactForm({ mode, entities, defaultValues }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  const [firstName, setFirstName] = useState(defaultValues.firstName);
  const [lastName, setLastName] = useState(defaultValues.lastName);
  const [email, setEmail] = useState(defaultValues.email);
  const [phone, setPhone] = useState(defaultValues.phone);
  const [jobTitle, setJobTitle] = useState(defaultValues.jobTitle);
  const [linkedinUrl, setLinkedinUrl] = useState(defaultValues.linkedinUrl);
  const [entityId, setEntityId] = useState(defaultValues.entityId || NONE_VALUE);
  const [notes, setNotes] = useState(defaultValues.notes);

  function buildPayload() {
    return {
      firstName,
      lastName,
      email: email || undefined,
      phone: phone || undefined,
      jobTitle: jobTitle || undefined,
      linkedinUrl: linkedinUrl || undefined,
      entityId: entityId === NONE_VALUE ? undefined : entityId,
      notes: notes || undefined,
    };
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const payload = buildPayload();
      const result =
        mode === "create"
          ? await createContact(payload)
          : await updateContact({ ...payload, id: defaultValues.id ?? "" });

      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        toast.error(result.message);
        return;
      }
      toast.success(mode === "create" ? "Contact créé." : "Contact mis à jour.");
      const id = mode === "create" ? result.data.id : defaultValues.id;
      router.push(`/contacts/${id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Identité</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">Prénom *</Label>
            <Input
              id="firstName"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={pending}
            />
            {errors.firstName ? (
              <p className="text-destructive text-xs">{errors.firstName[0]}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Nom *</Label>
            <Input
              id="lastName"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={pending}
            />
            {errors.lastName ? (
              <p className="text-destructive text-xs">{errors.lastName[0]}</p>
            ) : null}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="jobTitle">Fonction</Label>
            <Input
              id="jobTitle"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="CEO, Head of Ops…"
              disabled={pending}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="entityId">Entité</Label>
            <Select value={entityId} onValueChange={setEntityId} disabled={pending}>
              <SelectTrigger id="entityId">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>—</SelectItem>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Contact</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
            />
            {errors.email ? <p className="text-destructive text-xs">{errors.email[0]}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Téléphone</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="linkedinUrl">LinkedIn</Label>
            <Input
              id="linkedinUrl"
              type="url"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://www.linkedin.com/in/…"
              disabled={pending}
            />
            {errors.linkedinUrl ? (
              <p className="text-destructive text-xs">{errors.linkedinUrl[0]}</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Notes</h2>
        <Textarea
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={pending}
        />
      </section>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending || !firstName.trim() || !lastName.trim()}>
          {pending ? "Enregistrement…" : mode === "create" ? "Créer" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
