"use client";

import { UserAvatar } from "@/components/user/user-avatar";
import { markInvoiceReminded, setInvoiceAssignee, setInvoiceDueDate } from "@/lib/actions/invoices";
import type { DougsPaymentHint } from "@/lib/dougs/client";
import {
  ArrowRight,
  BellRinging,
  Buildings,
  Check,
  FlagPennant,
  HandCoins,
  Pencil,
  UserCircle,
} from "@phosphor-icons/react";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

export type UserOption = { id: string; fullName: string | null; avatarUrl: string | null };

type Tint = "blue" | "green" | "gray" | "orange" | "mauve" | "red";

function tintStyles(tint: Tint) {
  return {
    background: `var(--ds-tint-${tint}-bg)`,
    color: `var(--ds-tint-${tint}-text)`,
  };
}

function formatEur(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function formatDateFR(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(`${d.length === 10 ? `${d}T00:00:00` : d}`) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" });
}

const DOUGS_INV_URL = (id: string, paid: boolean) =>
  `https://app.dougs.fr/app/c/107610/invoicing/sales-invoice?status=${paid ? "paid" : "waiting"}&salesInvoiceId=${id}`;

export type RelanceItem = {
  invoiceId: string;
  kind: "milestone" | "coworking" | "one_off";
  label: string;
  projectId: string | null;
  projectName: string | null;
  coworkingContractId: string | null;
  contractName: string | null;
  entityName: string | null;
  amountHt: number;
  invoicedAt: string | null;
  dueDate: string | null;
  lastRemindedAt: string | null;
  reminderCount: number;
  dougsInvoiceId: string | null;
  assignedTo: string | null;
  assignedFullName: string | null;
  assignedAvatarUrl: string | null;
  /**
   * Virement entrant que Dougs a rattaché tout seul à cette facture,
   * sans que le rapprochement soit encore validé. Présent = ne pas
   * relancer sans vérifier.
   */
  paymentHint: DougsPaymentHint | null;
};

export function RelanceRow({
  item,
  today,
  userOptions,
}: {
  item: RelanceItem;
  today: string;
  userOptions: UserOption[];
}) {
  const router = useRouter();
  const [editingDate, setEditingDate] = useState(false);
  const [dueInput, setDueInput] = useState(item.dueDate ?? "");
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [pending, startTransition] = useTransition();
  const dateInputRef = useRef<HTMLInputElement>(null);
  const assigneeSelectRef = useRef<HTMLSelectElement>(null);

  // Focus l'input dès qu'on entre en mode édition. On évite autoFocus
  // (biome) qui se déclenche aussi à la première peinture.
  useEffect(() => {
    if (editingDate) dateInputRef.current?.focus();
  }, [editingDate]);
  useEffect(() => {
    if (editingAssignee) assigneeSelectRef.current?.focus();
  }, [editingAssignee]);

  function saveAssignee(nextId: string | null) {
    if (nextId === (item.assignedTo ?? null)) {
      setEditingAssignee(false);
      return;
    }
    startTransition(async () => {
      const res = await setInvoiceAssignee({ id: item.invoiceId, assignedTo: nextId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(nextId ? "Responsable mis à jour." : "Responsable retiré.");
      setEditingAssignee(false);
      router.refresh();
    });
  }

  const targetLink =
    item.kind === "coworking"
      ? `/coworking/factures/${item.invoiceId}`
      : item.projectId
        ? `/projets/${item.projectId}?tab=billing`
        : null;

  const tagTint: Tint =
    item.kind === "coworking" ? "mauve" : item.kind === "milestone" ? "blue" : "gray";
  const tagLabel =
    item.kind === "milestone" ? "JALON" : item.kind === "coworking" ? "COWORKING" : "FACTURE";
  const tagIcon =
    item.kind === "coworking" ? (
      <Buildings size={13} weight="duotone" />
    ) : (
      <FlagPennant size={13} weight="duotone" />
    );

  // Retard en jours (positif = en retard). Calcul côté client basé sur
  // une "date du jour" fournie par le serveur pour éviter les sauts d'UI.
  const overdueDays = item.dueDate ? daysBetween(item.dueDate, today) : null;
  const isOverdue = overdueDays !== null && overdueDays > 0;
  const isSoon = overdueDays !== null && overdueDays <= 0 && overdueDays >= -7;
  const overdueTint: Tint = overdueDays !== null && overdueDays > 30 ? "red" : "orange";

  function saveDueDate() {
    const value = dueInput.trim();
    const next = value === "" ? null : value;
    if (next === (item.dueDate ?? null)) {
      setEditingDate(false);
      return;
    }
    startTransition(async () => {
      const res = await setInvoiceDueDate({ id: item.invoiceId, dueDate: next });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(next ? "Échéance mise à jour." : "Échéance effacée.");
      setEditingDate(false);
      router.refresh();
    });
  }

  function markReminded() {
    startTransition(async () => {
      const res = await markInvoiceReminded({ id: item.invoiceId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Relance enregistrée.");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3 border-t px-1 py-3 text-sm">
      <span
        className="inline-flex flex-none items-center gap-1.5 rounded-md px-2 py-0.5 font-semibold text-[10px] tracking-wider"
        style={tintStyles(tagTint)}
      >
        <span style={{ color: `var(--ds-tint-${tagTint}-dot)` }}>{tagIcon}</span>
        {tagLabel}
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">
          {item.projectName ?? item.contractName ?? item.label}
        </div>
        <div className="truncate text-[12px] text-[var(--ds-text-tertiary)]">
          {item.label}
          {item.entityName ? ` · ${item.entityName}` : ""}
        </div>
      </div>

      {item.paymentHint ? <PaymentHintBadge hint={item.paymentHint} /> : null}

      {/* Échéance + retard */}
      <div className="flex flex-none items-center gap-1.5">
        {editingDate ? (
          <span className="flex items-center gap-1">
            <input
              ref={dateInputRef}
              type="date"
              value={dueInput}
              onChange={(e) => setDueInput(e.target.value)}
              className="rounded border bg-background px-1.5 py-0.5 text-[12px]"
              disabled={pending}
            />
            <button
              type="button"
              onClick={saveDueDate}
              disabled={pending}
              className="rounded p-0.5 text-foreground hover:bg-muted/40 disabled:opacity-50"
              aria-label="Enregistrer l'échéance"
            >
              <Check size={14} weight="bold" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setEditingDate(true)}
            className="group inline-flex items-center gap-1 rounded px-1 py-0.5 text-[12px] text-[var(--ds-text-tertiary)] hover:bg-muted/40 hover:text-foreground"
            aria-label="Modifier l'échéance"
          >
            <span className="tabular-nums">Éch. {formatDateFR(item.dueDate)}</span>
            <Pencil size={11} className="opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
        {overdueDays !== null && (isOverdue || isSoon) ? (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 font-semibold text-[11px] tabular-nums"
            style={tintStyles(isOverdue ? overdueTint : "gray")}
          >
            {isOverdue
              ? `+${overdueDays} j`
              : overdueDays === 0
                ? "aujourd'hui"
                : `J${overdueDays}`}
          </span>
        ) : null}
      </div>

      <span className="min-w-[96px] text-right font-semibold text-[14px] text-foreground tabular-nums">
        {formatEur(item.amountHt)}
      </span>

      {/* Responsable */}
      <div className="flex flex-none items-center">
        {editingAssignee ? (
          <select
            ref={assigneeSelectRef}
            defaultValue={item.assignedTo ?? ""}
            onChange={(e) => saveAssignee(e.target.value === "" ? null : e.target.value)}
            onBlur={() => setEditingAssignee(false)}
            disabled={pending}
            className="rounded border bg-background px-1.5 py-0.5 text-[12px]"
          >
            <option value="">— Personne —</option>
            {userOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName ?? "Sans nom"}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            onClick={() => setEditingAssignee(true)}
            className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted/40"
            aria-label="Changer le responsable"
            title={item.assignedFullName ?? "Aucun responsable assigné"}
          >
            {item.assignedTo ? (
              <UserAvatar
                size="xs"
                name={item.assignedFullName}
                avatarUrl={item.assignedAvatarUrl}
              />
            ) : (
              <UserCircle size={18} className="text-[var(--ds-text-tertiary)]" weight="duotone" />
            )}
            <span className="max-w-[100px] truncate text-[12px] text-foreground">
              {item.assignedFullName ?? "Assigner"}
            </span>
          </button>
        )}
      </div>

      {/* Statut de relance */}
      <div className="flex flex-none items-center gap-1.5">
        {item.reminderCount > 0 ? (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[11px]"
            style={tintStyles("mauve")}
          >
            <BellRinging size={11} weight="duotone" />#{item.reminderCount} ·{" "}
            {formatDateFR(item.lastRemindedAt)}
          </span>
        ) : (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 font-semibold text-[11px]"
            style={tintStyles("gray")}
          >
            Jamais relancée
          </span>
        )}
        <button
          type="button"
          onClick={markReminded}
          disabled={pending}
          className="rounded-md border px-2 py-1 font-medium text-[11px] hover:bg-muted/40 disabled:opacity-50"
        >
          Marquer relancée
        </button>
      </div>

      {/* Lien Dougs (optionnel) */}
      {item.dougsInvoiceId ? (
        <a
          href={DOUGS_INV_URL(item.dougsInvoiceId, false)}
          target="_blank"
          rel="noreferrer"
          className="flex-none rounded p-1 text-[var(--ds-text-tertiary)] hover:bg-muted/40 hover:text-foreground"
          aria-label="Ouvrir dans Dougs"
        >
          <ArrowSquareOut size={14} weight="bold" />
        </a>
      ) : null}

      {/* Lien fiche */}
      {targetLink ? (
        <Link
          href={targetLink}
          className="flex-none rounded p-1 text-[var(--ds-text-tertiary)] hover:bg-muted/40 hover:text-foreground"
          aria-label="Ouvrir la facture"
        >
          <ArrowRight size={13} weight="bold" />
        </Link>
      ) : null}
    </div>
  );
}

function daysBetween(dueISO: string, todayISO: string): number {
  // Renvoie le nombre de jours entiers (today - due). Positif = en retard.
  const a = Date.parse(`${dueISO}T00:00:00Z`);
  const b = Date.parse(`${todayISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Pastille "encaissement détecté". Le tooltip porte le détail utile
 * pour trancher sans quitter la page : date, montant et libellé brut du
 * relevé bancaire tels que Dougs les voit.
 */
function PaymentHintBadge({ hint }: { hint: DougsPaymentHint }) {
  const parts = [
    hint.date ? formatDateFR(hint.date) : null,
    hint.amount !== null ? formatEur(hint.amount) : null,
    hint.wording,
  ].filter(Boolean);

  return (
    <span
      className="inline-flex flex-none items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[11px]"
      style={tintStyles("green")}
      title={`Virement détecté par Dougs, rapprochement non validé — ${parts.join(" · ")}`}
    >
      <HandCoins size={12} weight="duotone" />
      Encaissé ?
    </span>
  );
}
