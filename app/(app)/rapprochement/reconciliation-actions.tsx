"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { Button } from "@/components/ui/button";
import {
  linkCoworkingContractAsNewInvoice,
  linkCoworkingInvoiceDougs,
  linkProjectAsNewMilestone,
  linkProjectDougsQuote,
  linkProjectMilestoneDougsInvoice,
  refreshAllDougsLinks,
} from "@/lib/actions/dougs-refresh";
import { CloudDownload, Link2, Plus } from "lucide-react";
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
  /** Label combiné: "Contract — YYYY-MM" pour searchValue. */
  label: string;
  /** Détails de l'option pour searchValue + tooltip. */
  contractName: string;
  clientName: string | null;
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
          label: `${i.contractName} · ${i.periodStart.slice(0, 7)}${i.alreadyLinked ? " · ⚠ déjà liée" : ""}`,
          searchValue: `${i.contractName} ${i.clientName ?? ""} ${i.periodStart} ${i.periodEnd}`,
        }))}
        searchPlaceholder="Rechercher (contrat, client, période)…"
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
