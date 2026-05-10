"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
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
import { scrollToFirstError } from "@/lib/forms/scroll-to-error";
import {
  type ContactQualification,
  contactQualificationEnum,
  contactQualificationLabels,
} from "@/lib/schemas/coworking";
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
    qualification: ContactQualification | "";
    notes: string;
  };
};

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
  const [entityId, setEntityId] = useState<string | null>(defaultValues.entityId || null);
  const [qualification, setQualification] = useState<ContactQualification | "">(
    defaultValues.qualification,
  );
  const [notes, setNotes] = useState(defaultValues.notes);

  function buildPayload() {
    return {
      firstName,
      lastName,
      email: email || undefined,
      phone: phone || undefined,
      jobTitle: jobTitle || undefined,
      linkedinUrl: linkedinUrl || undefined,
      entityId: entityId ?? undefined,
      qualification: qualification || undefined,
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
        scrollToFirstError(result.fieldErrors);
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
    <form onSubmit={onSubmit} className="space-y-10">
      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Identité
        </h2>
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
            <FieldError messages={errors.firstName} />
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
            <FieldError messages={errors.lastName} />
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
            <FkCombobox
              id="entityId"
              value={entityId}
              onValueChange={setEntityId}
              options={entities.map((e) => ({ id: e.id, label: e.name }))}
              searchPlaceholder="Rechercher une entité…"
              disabled={pending}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="qualification">Qualification</Label>
            <Select
              value={qualification || "_none"}
              onValueChange={(v) =>
                setQualification(v === "_none" ? "" : (v as ContactQualification))
              }
              disabled={pending}
            >
              <SelectTrigger id="qualification">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— Aucune —</SelectItem>
                {contactQualificationEnum.options.map((q) => (
                  <SelectItem key={q} value={q}>
                    {contactQualificationLabels[q]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Contact
        </h2>
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
            <FieldError messages={errors.email} />
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
            <FieldError messages={errors.linkedinUrl} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Notes
        </h2>
        <Textarea
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={pending}
        />
      </section>

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background/90 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
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
