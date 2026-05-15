"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { Button } from "@/components/ui/button";
import {
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
