"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { Button } from "@/components/ui/button";
import { linkDougsCreditNote, unlinkDougsCreditNote } from "@/lib/actions/dougs-credit-notes";
import { unlinkProjectDougsQuote } from "@/lib/actions/dougs-quotes";
import {
  linkCoworkingContractAsNewInvoice,
  linkCoworkingInvoiceDougs,
  linkProjectAsNewMilestone,
  linkProjectDougsQuote,
  linkProjectMilestoneDougsInvoice,
  refreshAllDougsLinks,
  unlinkCoworkingInvoiceDougs,
  unlinkProjectMilestoneDougsInvoice,
} from "@/lib/actions/dougs-refresh";
import { CloudDownload, Link2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export function RefreshAllButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await refreshAllDougsLinks({});
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          const { quotesUpdated, milestonesUpdated, coworkingUpdated, errors } = res.data;
          toast.success(
            `Synchro Dougs : ${quotesUpdated} devis · ${milestonesUpdated} jalons · ${coworkingUpdated} coworking${errors.length > 0 ? ` (${errors.length} erreurs)` : ""}`,
          );
          router.refresh();
        });
      }}
      className="gap-1.5"
    >
      <CloudDownload className="size-3.5" />
      {pending ? "Synchro…" : "Tout rafraîchir"}
    </Button>
  );
}

export type ProjectOption = {
  id: string;
  name: string;
  entityName: string | null;
  valueAmount: number | null;
};

export type CoworkingInvoiceOption = {
  id: string;
  /** Label complet affiché dans le combobox. */
  label: string;
  /** Détails pour searchValue + tooltip. */
  contractName: string;
  clientName: string | null;
  /** Date d'émission (YYYY-MM-DD) si la facture est déjà émise. */
  invoiceDate: string | null;
  periodStart: string;
  periodEnd: string;
  amountHt: number;
  /** Indique si la facture est déjà liée à un Dougs. Affichée différemment. */
  alreadyLinked: boolean;
};

export function LinkQuoteButton({
  projectId,
  dougsId,
}: {
  projectId: string;
  dougsId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await linkProjectDougsQuote({ projectId, dougsIdOrUrl: dougsId });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success(`Lié : ${res.data.reference ?? "—"}`);
          router.refresh();
        });
      }}
      className="gap-1.5"
    >
      <Link2 className="size-3.5" />
      {pending ? "Lié…" : "Lier"}
    </Button>
  );
}

export function LinkMilestoneButton({
  projectId,
  milestoneId,
  dougsId,
}: {
  projectId: string;
  milestoneId: string;
  dougsId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await linkProjectMilestoneDougsInvoice({
            projectId,
            milestoneId,
            dougsIdOrUrl: dougsId,
          });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success(`Lié : ${res.data.reference ?? "—"}`);
          router.refresh();
        });
      }}
      className="gap-1.5"
    >
      <Link2 className="size-3.5" />
      {pending ? "Lié…" : "Lier"}
    </Button>
  );
}

export function LinkProjectAsMilestoneButton({
  projectId,
  dougsId,
  detectedPercent,
}: {
  projectId: string;
  dougsId: string;
  detectedPercent: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label =
    detectedPercent != null && detectedPercent < 50
      ? `Lier (acompte ${detectedPercent} %)`
      : detectedPercent != null && detectedPercent >= 95
        ? "Lier (solde 100 %)"
        : detectedPercent != null && detectedPercent > 50
          ? `Lier (solde ${detectedPercent} %)`
          : detectedPercent != null
            ? `Lier (${detectedPercent} %)`
            : "Lier (nouveau jalon)";
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await linkProjectAsNewMilestone({
            projectId,
            dougsIdOrUrl: dougsId,
            detectedPercent: detectedPercent ?? null,
          });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success(`Jalon créé : ${res.data.milestoneLabel}`);
          router.refresh();
        });
      }}
      className="gap-1.5"
    >
      <Plus className="size-3.5" />
      {pending ? "Création…" : label}
    </Button>
  );
}

/**
 * Pickers manuels — combobox de tous les projets, pour lier une entrée
 * Dougs (devis ou facture) à n'importe quel projet, même si l'auto-suggest
 * ne l'a pas trouvé.
 */
function ProjectPicker({
  projects,
  pending,
  selected,
  onChange,
}: {
  projects: ProjectOption[];
  pending: boolean;
  selected: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <FkCombobox
      value={selected}
      onValueChange={onChange}
      options={projects.map((p) => ({
        id: p.id,
        label: p.name,
        searchValue: `${p.name} ${p.entityName ?? ""}`,
      }))}
      searchPlaceholder="Rechercher un projet…"
      placeholder="Choisir un projet…"
      disabled={pending}
      className="flex-1"
    />
  );
}

export function ManualLinkQuote({
  dougsId,
  projects,
}: { dougsId: string; projects: ProjectOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  function submit() {
    if (!selected) return;
    startTransition(async () => {
      const res = await linkProjectDougsQuote({ projectId: selected, dougsIdOrUrl: dougsId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Devis lié : ${res.data.reference ?? "—"}`);
      setOpen(false);
      setSelected(null);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
      >
        <Link2 className="size-3" />
        Lier manuellement à un projet…
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 p-2">
      <ProjectPicker
        projects={projects}
        pending={pending}
        selected={selected}
        onChange={setSelected}
      />
      <Button type="button" size="sm" onClick={submit} disabled={pending || !selected}>
        Lier
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(false);
          setSelected(null);
        }}
        disabled={pending}
      >
        Annuler
      </Button>
    </div>
  );
}

export function ManualLinkInvoice({
  dougsId,
  projects,
}: {
  dougsId: string;
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  function submit() {
    if (!selected) return;
    startTransition(async () => {
      // On crée un jalon à la volée sur le projet sélectionné — pas de
      // detectedPercent → le serveur calcule depuis valueAmount projet.
      const res = await linkProjectAsNewMilestone({
        projectId: selected,
        dougsIdOrUrl: dougsId,
        detectedPercent: null,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Jalon créé : ${res.data.milestoneLabel}`);
      setOpen(false);
      setSelected(null);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
      >
        <Link2 className="size-3" />
        Lier manuellement à un projet (créera un jalon)…
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 p-2">
      <ProjectPicker
        projects={projects}
        pending={pending}
        selected={selected}
        onChange={setSelected}
      />
      <Button type="button" size="sm" onClick={submit} disabled={pending || !selected}>
        Lier
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(false);
          setSelected(null);
        }}
        disabled={pending}
      >
        Annuler
      </Button>
    </div>
  );
}

/**
 * Picker manuel pour lier une facture Dougs à une coworking_invoice
 * existante (matching auto raté, ou facture déjà liée à un mauvais
 * Dougs qu'on veut ré-attribuer).
 *
 * On expose toutes les factures coworking (y compris déjà liées) — la
 * badge `alreadyLinked` indique celles qui écrasent un lien existant.
 */
export function ManualLinkCoworkingInvoice({
  dougsId,
  invoices,
}: {
  dougsId: string;
  invoices: CoworkingInvoiceOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  function submit() {
    if (!selected) return;
    startTransition(async () => {
      const res = await linkCoworkingInvoiceDougs({
        coworkingInvoiceId: selected,
        dougsIdOrUrl: dougsId,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Facture Dougs liée : ${res.data.reference ?? "—"}`);
      setOpen(false);
      setSelected(null);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
      >
        <Link2 className="size-3" />
        Lier manuellement à une facture coworking existante…
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 p-2">
      <FkCombobox
        value={selected}
        onValueChange={setSelected}
        options={invoices.map((i) => ({
          id: i.id,
          label: `${i.label}${i.alreadyLinked ? " · ⚠ déjà liée" : ""}`,
          searchValue: `${i.contractName} ${i.clientName ?? ""} ${i.periodStart} ${i.periodEnd} ${i.invoiceDate ?? ""}`,
        }))}
        searchPlaceholder="Rechercher (contrat, client, période, date)…"
        placeholder="Choisir une facture coworking…"
        disabled={pending}
        className="flex-1"
      />
      <Button type="button" size="sm" onClick={submit} disabled={pending || !selected}>
        Lier
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(false);
          setSelected(null);
        }}
        disabled={pending}
      >
        Annuler
      </Button>
    </div>
  );
}

export function LinkCoworkingContractButton({
  contractId,
  dougsId,
}: {
  contractId: string;
  dougsId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await linkCoworkingContractAsNewInvoice({
            contractId,
            dougsIdOrUrl: dougsId,
          });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success(
            `Facture coworking créée (${res.data.periodStart} → ${res.data.periodEnd}).`,
          );
          router.refresh();
        });
      }}
      className="gap-1.5"
    >
      <Plus className="size-3.5" />
      {pending ? "Création…" : "Créer facture"}
    </Button>
  );
}

export function LinkCoworkingInvoiceButton({
  coworkingInvoiceId,
  dougsId,
}: {
  coworkingInvoiceId: string;
  dougsId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await linkCoworkingInvoiceDougs({
            coworkingInvoiceId,
            dougsIdOrUrl: dougsId,
          });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success(`Lié : ${res.data.reference ?? "—"}`);
          router.refresh();
        });
      }}
      className="gap-1.5"
    >
      <Link2 className="size-3.5" />
      {pending ? "Lié…" : "Lier"}
    </Button>
  );
}

export type InvoiceOption = {
  id: string;
  reference: string | null;
  clientName: string;
  totalHt: number | null;
  createdAt: string | null;
};

function formatEurOption(n: number | null): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

/** Picker pour rattacher une facture d'avoir à la facture qu'elle annule. */
export function LinkCreditNotePicker({
  creditNoteId,
  options,
}: { creditNoteId: string; options: InvoiceOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string | null>(null);

  function submit() {
    if (!selected) return;
    startTransition(async () => {
      const res = await linkDougsCreditNote({
        creditNoteId,
        originalInvoiceId: selected,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Avoir rattaché");
      setSelected(null);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed bg-background/50 p-2">
      <FkCombobox
        value={selected}
        onValueChange={setSelected}
        options={options.map((o) => {
          const ref = o.reference ?? "—";
          const date = o.createdAt ? new Date(o.createdAt).toLocaleDateString("fr-FR") : "—";
          return {
            id: o.id,
            label: `${ref} · ${o.clientName} · ${formatEurOption(o.totalHt)} · ${date}`,
            searchValue: `${ref} ${o.clientName} ${formatEurOption(o.totalHt)} ${date}`,
          };
        })}
        searchPlaceholder="Rechercher une facture (n° / client / montant)…"
        placeholder="Choisir la facture annulée par cet avoir…"
        disabled={pending}
        className="flex-1"
      />
      <Button type="button" size="sm" onClick={submit} disabled={pending || !selected}>
        <Link2 className="size-3.5" />
        {pending ? "Lié…" : "Lier"}
      </Button>
    </div>
  );
}

/**
 * Bouton générique "défaire le lien" — utilisé pour les entrées Dougs
 * déjà rattachées dans la section dépliable. Caller décide quelle
 * action effectuer.
 */
function UnlinkButton({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      aria-label="Défaire le lien"
      title="Défaire le lien Dougs"
    >
      <X className="size-3.5" />
    </button>
  );
}

export function UnlinkProjectQuoteButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <UnlinkButton
      pending={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await unlinkProjectDougsQuote({ projectId });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success("Devis délié");
          router.refresh();
        });
      }}
    />
  );
}

export function UnlinkMilestoneButton({
  projectId,
  milestoneId,
}: { projectId: string; milestoneId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <UnlinkButton
      pending={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await unlinkProjectMilestoneDougsInvoice({ projectId, milestoneId });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success("Jalon délié");
          router.refresh();
        });
      }}
    />
  );
}

export function UnlinkCoworkingInvoiceButton({
  coworkingInvoiceId,
}: { coworkingInvoiceId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <UnlinkButton
      pending={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await unlinkCoworkingInvoiceDougs({ coworkingInvoiceId });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success("Facture coworking déliée");
          router.refresh();
        });
      }}
    />
  );
}

export function UnlinkCreditNoteButton({ creditNoteId }: { creditNoteId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await unlinkDougsCreditNote({ creditNoteId });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success("Lien retiré");
          router.refresh();
        });
      }}
      className="inline-flex items-center gap-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      aria-label="Retirer le lien"
    >
      <X className="size-3.5" />
    </button>
  );
}
