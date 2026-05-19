"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { Button } from "@/components/ui/button";
import {
  linkDougsCreditNote,
  linkInvoiceToDougs,
  linkProjectAsNewMilestone,
  linkProjectQuoteToDougs,
  refreshAllDougsLinks,
  unlinkDougsCreditNote,
} from "@/lib/actions/invoices";
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
          toast.success(
            `Synchro Dougs : ${res.data.updated} entrées${res.data.errors.length > 0 ? ` (${res.data.errors.length} erreurs)` : ""}`,
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
  label: string;
  contractName: string;
  clientName: string | null;
  invoiceDate: string | null;
  periodStart: string;
  periodEnd: string;
  amountHt: number;
  alreadyLinked: boolean;
};

// =====================================================================
// Boutons de liaison auto-suggérée
// =====================================================================

export function LinkInvoiceButton({ invoiceId, dougsId }: { invoiceId: string; dougsId: string }) {
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
          const res = await linkInvoiceToDougs({ invoiceId, dougsIdOrUrl: dougsId });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success("Facture liée.");
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

export function LinkQuoteButton({ projectId, dougsId }: { projectId: string; dougsId: string }) {
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
          const res = await linkProjectQuoteToDougs({ projectId, dougsIdOrUrl: dougsId });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success(`Devis lié : ${res.data.reference ?? "—"}`);
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

// =====================================================================
// Picker manuels (combobox)
// =====================================================================

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
      const res = await linkProjectQuoteToDougs({ projectId: selected, dougsIdOrUrl: dougsId });
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
}: { dougsId: string; projects: ProjectOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  function submit() {
    if (!selected) return;
    startTransition(async () => {
      const res = await linkProjectAsNewMilestone({
        projectId: selected,
        dougsIdOrUrl: dougsId,
        detectedPercent: null,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Facture liée comme nouveau jalon.");
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
        Lier manuellement à un projet (nouveau jalon)…
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

export function ManualLinkCoworkingInvoice({
  dougsId,
  invoices,
}: { dougsId: string; invoices: CoworkingInvoiceOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  function submit() {
    if (!selected) return;
    startTransition(async () => {
      const res = await linkInvoiceToDougs({ invoiceId: selected, dougsIdOrUrl: dougsId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Facture coworking liée.");
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
          label: i.label,
          searchValue: `${i.contractName} ${i.clientName ?? ""} ${i.label} ${i.periodStart}`,
        }))}
        searchPlaceholder="Rechercher (contrat / période)…"
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

// =====================================================================
// Picker avoir → facture annulée
// =====================================================================

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
      toast.success("Avoir rattaché.");
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
          toast.success("Lien retiré.");
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
