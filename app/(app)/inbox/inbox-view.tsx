"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { decideInboxItem, loadInboxPreview } from "@/lib/actions/inbox";
import type {
  InboxExtractionKind,
  InboxItem,
  InboxReconciliation,
  InboxSource,
} from "@/lib/db/queries/inbox";
import type { InboxPreview } from "@/lib/db/queries/inbox-preview";
import { cn } from "@/lib/utils";
import {
  ArrowSquareOut,
  Buildings,
  CalendarBlank,
  Check,
  CheckCircle,
  CheckSquare,
  Envelope,
  EnvelopeOpen,
  Link as LinkIcon,
  ListChecks,
  Microphone,
  PencilSimple,
  type Icon as PhosphorIcon,
  Receipt,
  Star,
  Tag,
  User,
  UserPlus,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

type FilterKey = "all" | InboxExtractionKind;

type KindDef = {
  key: InboxExtractionKind;
  label: string;
  actionLabel: string;
  icon: PhosphorIcon;
  bg: string;
  textColor: string;
};

const KINDS: KindDef[] = [
  {
    key: "task",
    label: "Tâches",
    actionLabel: "Nouvelle tâche",
    icon: CheckSquare,
    bg: "var(--ds-tint-blue-bg)",
    textColor: "var(--ds-tint-blue-text)",
  },
  {
    key: "contact",
    label: "Contacts",
    actionLabel: "Nouveau contact",
    icon: UserPlus,
    bg: "var(--ds-tint-mauve-bg)",
    textColor: "var(--ds-tint-mauve-text)",
  },
  {
    key: "entity",
    label: "Entités",
    actionLabel: "Nouvelle entité",
    icon: Buildings,
    bg: "var(--ds-tint-brown-bg)",
    textColor: "var(--ds-tint-brown-text)",
  },
  {
    key: "project",
    label: "Projets",
    actionLabel: "Nouveau projet",
    icon: Star,
    bg: "var(--ds-tint-green-bg)",
    textColor: "var(--ds-tint-green-text)",
  },
  {
    key: "opportunity",
    label: "Opportunités",
    actionLabel: "Nouvelle opportunité",
    icon: Star,
    bg: "var(--ds-tint-green-bg)",
    textColor: "var(--ds-tint-green-text)",
  },
  {
    key: "project_link",
    label: "Rattachements projet",
    actionLabel: "Rattacher au projet",
    icon: LinkIcon,
    bg: "var(--ds-tint-mauve-bg)",
    textColor: "var(--ds-tint-mauve-text)",
  },
  {
    key: "entity_link",
    label: "Rattachements entité",
    actionLabel: "Rattacher à l'entité",
    icon: LinkIcon,
    bg: "var(--ds-tint-mauve-bg)",
    textColor: "var(--ds-tint-mauve-text)",
  },
  {
    key: "project_contact_link",
    label: "Contacts projet",
    actionLabel: "Ajouter comme contact projet",
    icon: LinkIcon,
    bg: "var(--ds-tint-mauve-bg)",
    textColor: "var(--ds-tint-mauve-text)",
  },
  {
    key: "category_tag",
    label: "Tags email",
    actionLabel: "Appliquer le tag",
    icon: Tag,
    bg: "var(--ds-tint-pink-bg)",
    textColor: "var(--ds-tint-pink-text)",
  },
  {
    key: "invoice_filing",
    label: "Factures fournisseurs",
    actionLabel: "Relancer le classement",
    icon: Receipt,
    bg: "var(--ds-tint-yellow-bg)",
    textColor: "var(--ds-tint-yellow-text)",
  },
  {
    key: "quote_reconciliation",
    label: "Devis à rapprocher",
    actionLabel: "Rattacher au projet",
    icon: Receipt,
    bg: "var(--ds-tint-yellow-bg)",
    textColor: "var(--ds-tint-yellow-text)",
  },
  {
    key: "invoice_reconciliation",
    label: "Factures clients à rapprocher",
    actionLabel: "Rattacher / créer jalon",
    icon: Receipt,
    bg: "var(--ds-tint-yellow-bg)",
    textColor: "var(--ds-tint-yellow-text)",
  },
];

const KIND_BY_KEY: Record<InboxExtractionKind, KindDef> = KINDS.reduce(
  (acc, k) => {
    acc[k.key] = k;
    return acc;
  },
  {} as Record<InboxExtractionKind, KindDef>,
);

const SOURCE_ICON: Record<InboxSource, PhosphorIcon> = {
  email: EnvelopeOpen,
  meeting: Microphone,
  filing: Receipt,
  reconciliation: Receipt,
};

const SOURCE_LABEL: Record<InboxSource, string> = {
  email: "Email",
  meeting: "Meeting",
  filing: "Facture fournisseur",
  reconciliation: "Dougs",
};

const PRIORITY_STYLE: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  urgent: {
    label: "Urgent",
    bg: "var(--ds-tint-red-bg)",
    text: "var(--ds-tint-red-text)",
    dot: "var(--ds-tint-red-dot)",
  },
  high: {
    label: "Haute",
    bg: "var(--ds-tint-orange-bg)",
    text: "var(--ds-tint-orange-text)",
    dot: "var(--ds-tint-orange-dot)",
  },
  haute: {
    label: "Haute",
    bg: "var(--ds-tint-orange-bg)",
    text: "var(--ds-tint-orange-text)",
    dot: "var(--ds-tint-orange-dot)",
  },
  normal: {
    label: "Normale",
    bg: "var(--ds-tint-gray-bg)",
    text: "var(--ds-tint-gray-text)",
    dot: "var(--ds-tint-gray-dot)",
  },
  low: {
    label: "Basse",
    bg: "var(--ds-tint-gray-bg)",
    text: "var(--ds-tint-gray-text)",
    dot: "var(--ds-tint-gray-dot)",
  },
};

function formatDueDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

const PROJECT_TINTS: string[] = [
  "var(--ds-tint-orange-dot)",
  "var(--ds-tint-blue-dot)",
  "var(--ds-tint-green-dot)",
  "var(--ds-tint-mauve-dot)",
  "var(--ds-tint-pink-dot)",
  "var(--ds-tint-yellow-dot)",
  "var(--ds-tint-brown-dot)",
  "var(--ds-tint-red-dot)",
];
function projectTint(id: string, color: string | null | undefined): string {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return color;
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PROJECT_TINTS[h % PROJECT_TINTS.length] ?? "var(--ds-tint-blue-dot)";
}

export function InboxView({ items }: { items: InboxItem[] }) {
  const router = useRouter();
  const [kindFilter, setKindFilter] = useState<FilterKey>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | InboxSource>("all");
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [bulkPending, startBulk] = useTransition();
  const [previewItem, setPreviewItem] = useState<InboxItem | null>(null);

  const visible = useMemo(
    () =>
      items.filter(
        (it) =>
          !dismissed.has(it.id) &&
          (kindFilter === "all" || it.kind === kindFilter) &&
          (sourceFilter === "all" || it.source === sourceFilter),
      ),
    [items, kindFilter, sourceFilter, dismissed],
  );

  const remainingTotal = items.length - dismissed.size;

  type KindTab = { key: FilterKey; label: string; icon: PhosphorIcon | null; count: number };
  const rawKindTabs: KindTab[] = [
    { key: "all", label: "Tout", icon: ListChecks, count: remainingTotal },
  ];
  for (const k of KINDS) {
    const remaining = items.filter((it) => it.kind === k.key && !dismissed.has(it.id)).length;
    if (remaining > 0)
      rawKindTabs.push({ key: k.key, label: k.label, icon: k.icon, count: remaining });
  }
  const kindTabs = rawKindTabs.filter((t) => t.count > 0);

  const sourceCounts: Record<InboxSource, number> = {
    email: items.filter((it) => it.source === "email" && !dismissed.has(it.id)).length,
    meeting: items.filter((it) => it.source === "meeting" && !dismissed.has(it.id)).length,
    filing: items.filter((it) => it.source === "filing" && !dismissed.has(it.id)).length,
    reconciliation: items.filter((it) => it.source === "reconciliation" && !dismissed.has(it.id))
      .length,
  };
  const sourceTabs: { key: "all" | InboxSource; label: string; count: number }[] = [
    { key: "all", label: "Toutes sources", count: remainingTotal },
    ...(["email", "meeting", "filing", "reconciliation"] as InboxSource[])
      .filter((s) => sourceCounts[s] > 0)
      .map((s) => ({ key: s, label: SOURCE_LABEL[s], count: sourceCounts[s] })),
  ];

  function dismissLocally(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  async function bulkDecide(action: "accept" | "reject") {
    if (visible.length === 0) return;
    if (
      !window.confirm(
        action === "accept"
          ? `Créer les ${visible.length} extractions visibles ?`
          : `Rejeter les ${visible.length} extractions visibles ?`,
      )
    )
      return;
    const targets = [...visible];
    startBulk(async () => {
      const results = await Promise.allSettled(
        targets.map((it) =>
          decideInboxItem({
            source: it.source,
            id: it.sourceId,
            action,
            reconciliation: it.reconciliation ?? null,
          }).then((res) => ({
            id: it.id,
            res,
          })),
        ),
      );
      let ok = 0;
      let err = 0;
      const failedIds = new Set<string>();
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.res.ok) {
          ok++;
        } else {
          err++;
          if (r.status === "fulfilled") failedIds.add(r.value.id);
        }
      }
      setDismissed((prev) => {
        const next = new Set(prev);
        for (const it of targets) if (!failedIds.has(it.id)) next.add(it.id);
        return next;
      });
      if (err === 0)
        toast.success(
          action === "accept" ? `${ok} extractions créées.` : `${ok} extractions rejetées.`,
        );
      else toast.error(`${ok} traitées, ${err} en erreur.`);
      router.refresh();
    });
  }

  if (remainingTotal === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-ds-border border-dashed bg-ds-app px-6 py-16 text-center">
        <div className="rounded-full bg-primary-50 p-3">
          <CheckCircle weight="duotone" className="size-6 text-primary-500" />
        </div>
        <h2 className="font-semibold text-ds-text text-sm">Rien à valider</h2>
        <p className="max-w-sm text-ds-text-tertiary text-sm">
          Toutes les extractions IA (emails, meetings, factures fournisseurs) ont été traitées.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Barre d'actions bulk */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ds-text-muted text-xs">
          {visible.length} extraction{visible.length > 1 ? "s" : ""} visible
          {visible.length > 1 ? "s" : ""}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => bulkDecide("reject")}
          disabled={bulkPending || visible.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-tint-red-bg bg-tint-red-bg px-2.5 py-1 font-medium text-[12px] text-tint-red-text transition-colors hover:border-tint-red-dot disabled:opacity-40"
        >
          <X weight="bold" className="size-3" />
          Tout rejeter
        </button>
        <button
          type="button"
          onClick={() => bulkDecide("accept")}
          disabled={bulkPending || visible.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-tint-green-dot bg-tint-green-bg px-2.5 py-1 font-medium text-[12px] text-tint-green-text transition-colors hover:bg-tint-green-dot hover:text-white disabled:opacity-40"
        >
          <Check weight="bold" className="size-3" />
          Tout créer
        </button>
      </div>

      {/* Filtres par type d'extraction */}
      <div className="-mx-1 flex flex-wrap gap-1.5 overflow-x-auto px-1">
        {kindTabs.map((t) => {
          const active = t.key === kindFilter;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setKindFilter(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                active
                  ? "border-primary-500 bg-primary-500 text-white"
                  : "border-ds-border bg-ds-app text-ds-text-muted hover:border-ds-border-strong hover:text-ds-text",
              )}
            >
              {Icon ? <Icon weight="duotone" className="size-3" /> : null}
              {t.label}
              <span
                className={cn(
                  "inline-flex min-w-4 items-center justify-center rounded-full px-1 py-0 font-mono font-semibold text-[10px]",
                  active ? "bg-white/25 text-white" : "bg-ds-hover text-ds-text-tertiary",
                )}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Sous-filtre par source */}
      {sourceTabs.length > 2 ? (
        <div className="flex flex-wrap items-center gap-2 border-ds-border border-b pb-3">
          <span className="text-[11px] text-ds-text-tertiary uppercase tracking-wider">Source</span>
          {sourceTabs.map((t) => {
            const active = t.key === sourceFilter;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSourceFilter(t.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] transition-colors",
                  active
                    ? "bg-ds-surface font-medium text-ds-text"
                    : "text-ds-text-muted hover:text-ds-text",
                )}
              >
                {t.label}
                <span className="font-mono text-[10px] text-ds-text-tertiary">{t.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Liste plate */}
      <div className="overflow-hidden rounded-[10px] border border-ds-border bg-ds-app">
        {visible.length === 0 ? (
          <div className="px-4 py-6 text-center text-ds-text-tertiary text-sm">
            Aucune extraction ne correspond à ces filtres.
          </div>
        ) : (
          visible.map((it, i) => (
            <InboxRow
              key={it.id}
              item={it}
              isLast={i === visible.length - 1}
              onDismiss={(id) => {
                dismissLocally(id);
                if (previewItem?.id === id) setPreviewItem(null);
              }}
              onOpenPreview={() => setPreviewItem(it)}
            />
          ))
        )}
      </div>

      <PreviewSheet item={previewItem} onClose={() => setPreviewItem(null)} />
    </div>
  );
}

const EDITABLE_KINDS = new Set<InboxExtractionKind>([
  "task",
  "opportunity",
  "contact",
  "entity",
  "project",
  "category_tag",
  "quote_reconciliation",
  "invoice_reconciliation",
]);

function InboxRow({
  item,
  isLast,
  onDismiss,
  onOpenPreview,
}: {
  item: InboxItem;
  isLast: boolean;
  onDismiss: (id: string) => void;
  onOpenPreview: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const kindDef = KIND_BY_KEY[item.kind];
  const SourceIcon = SOURCE_ICON[item.source];
  const KindIcon = kindDef?.icon ?? User;
  const canEdit = EDITABLE_KINDS.has(item.kind) && item.source !== "filing";

  const priorityStyle = item.meta.priority ? PRIORITY_STYLE[item.meta.priority] : undefined;
  const projectDot = item.projectId ? projectTint(item.projectId, item.projectColor) : null;
  const confidencePct =
    item.matchConfidence !== null ? Math.round(item.matchConfidence * 100) : null;

  function decide(
    e: React.MouseEvent | null,
    action: "accept" | "reject",
    overrides?: {
      payloadOverride?: Record<string, unknown>;
      reconciliation?: InboxReconciliation | null;
    },
  ) {
    e?.preventDefault();
    e?.stopPropagation();
    startTransition(async () => {
      const res = await decideInboxItem({
        source: item.source,
        id: item.sourceId,
        action,
        payloadOverride: overrides?.payloadOverride ?? null,
        reconciliation: overrides?.reconciliation ?? item.reconciliation ?? null,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      // Traite aussi les propositions dupliquées : quand on accepte
      // (le record est créé), on rejette les autres pour éviter
      // que la même action revienne. Quand on rejette, on rejette
      // tout le groupe. Best-effort : les erreurs individuelles ne
      // font pas échouer l'action principale déjà réussie.
      if (item.duplicates.length > 0) {
        const dupAction = action === "accept" ? "reject" : "reject";
        await Promise.allSettled(
          item.duplicates.map((d) =>
            decideInboxItem({
              source: d.source,
              id: d.sourceId,
              action: dupAction,
            }),
          ),
        );
      }
      onDismiss(item.id);
      toast.success(action === "accept" ? "Créé." : "Rejeté.");
      router.refresh();
    });
  }

  return (
    <div className={cn(!isLast && "border-ds-border border-b", pending && "opacity-50")}>
      <div
        className={cn("group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-ds-hover")}
      >
        {/* Icône du type */}
        <span
          className="mt-0.5 flex size-8 flex-none items-center justify-center rounded-md"
          style={{ background: kindDef?.bg ?? "var(--ds-hover)" }}
        >
          <KindIcon
            weight="duotone"
            className="size-4"
            style={{ color: kindDef?.textColor ?? "var(--ds-text-muted)" }}
          />
        </span>

        {/* Corps */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={onOpenPreview}
              className="min-w-0 truncate text-left font-medium text-ds-text text-sm hover:underline focus:outline-none focus-visible:underline"
            >
              {item.title}
            </button>
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0 text-[10px]"
              style={{
                background: kindDef?.bg,
                color: kindDef?.textColor,
                borderColor: kindDef?.textColor,
              }}
            >
              {kindDef?.actionLabel ?? "À valider"}
            </span>
            {confidencePct !== null ? (
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0 font-mono text-[10px]",
                  confidencePct >= 80
                    ? "bg-tint-green-bg text-tint-green-text"
                    : confidencePct >= 55
                      ? "bg-tint-yellow-bg text-tint-yellow-text"
                      : "bg-tint-gray-bg text-tint-gray-text",
                )}
                title={`Confiance du match : ${confidencePct} %`}
              >
                {confidencePct}%
              </span>
            ) : null}
            {item.duplicates.length > 0 ? (
              <span
                className="shrink-0 rounded-full bg-ds-hover px-1.5 py-0 font-mono text-[10px] text-ds-text-tertiary"
                title={`Regroupement : ${item.duplicates.length + 1} extractions identiques (garder ×1)`}
              >
                ×{item.duplicates.length + 1}
              </span>
            ) : null}
          </div>

          {/* Meta chips */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {item.meta.assigneeName ? (
              <MetaChip
                icon={<User weight="duotone" className="size-3" />}
                label={item.meta.assigneeName}
              />
            ) : null}
            {priorityStyle ? (
              <span
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0 font-medium text-[10px]"
                style={{ background: priorityStyle.bg, color: priorityStyle.text }}
              >
                <span
                  className="size-[6px] rounded-full"
                  style={{ background: priorityStyle.dot }}
                />
                {priorityStyle.label}
              </span>
            ) : null}
            {item.meta.projectName ? (
              <MetaChip
                icon={
                  projectDot ? (
                    <span
                      className="size-[6px] rounded-full"
                      style={{ background: projectDot }}
                      aria-hidden
                    />
                  ) : (
                    <Star weight="duotone" className="size-3" />
                  )
                }
                label={item.meta.projectName}
              />
            ) : null}
            {item.meta.dueDate ? (
              <MetaChip
                icon={<CalendarBlank weight="duotone" className="size-3" />}
                label={formatDueDate(item.meta.dueDate)}
              />
            ) : null}
            {item.meta.contactEmail ? (
              <MetaChip
                icon={<Envelope weight="duotone" className="size-3" />}
                label={item.meta.contactEmail}
              />
            ) : null}
            {item.meta.entityName ? (
              <MetaChip
                icon={<Buildings weight="duotone" className="size-3" />}
                label={item.meta.entityName}
              />
            ) : null}
            {item.detail ? (
              <span className="truncate text-[11px] text-ds-text-tertiary">{item.detail}</span>
            ) : null}
          </div>

          {/* Ligne source */}
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-ds-text-tertiary">
            <SourceIcon weight="duotone" className="size-3 shrink-0 text-ds-text-muted" />
            <button
              type="button"
              onClick={onOpenPreview}
              className="truncate text-left hover:underline focus:outline-none focus-visible:underline"
            >
              {item.sourceLabel}
            </button>
            {item.dateLabel ? (
              <>
                <span className="text-ds-text-muted">·</span>
                <span className="shrink-0">{item.dateLabel}</span>
              </>
            ) : null}
          </div>
        </div>

        {/* Actions inline */}
        <div className="flex flex-none items-center gap-1.5">
          {canEdit ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setEditing((v) => !v);
              }}
              disabled={pending}
              aria-label="Modifier"
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-md border border-ds-border bg-ds-app text-ds-text-tertiary transition-colors hover:border-ds-border-strong hover:text-ds-text disabled:opacity-40",
                editing && "border-primary-500 bg-primary-50 text-primary-700",
              )}
            >
              <PencilSimple weight="bold" className="size-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={(e) => decide(e, "reject")}
            disabled={pending}
            aria-label="Rejeter"
            className="inline-flex size-7 items-center justify-center rounded-md border border-transparent bg-tint-red-bg text-tint-red-text transition-colors hover:border-tint-red-dot focus-visible:border-tint-red-dot disabled:opacity-40"
          >
            <X weight="bold" className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => decide(e, "accept")}
            disabled={pending}
            aria-label={kindDef?.actionLabel ?? "Accepter"}
            className="inline-flex size-7 items-center justify-center rounded-md border border-tint-green-dot bg-tint-green-bg text-tint-green-text transition-colors hover:bg-tint-green-dot hover:text-white disabled:opacity-40"
          >
            <Check weight="bold" className="size-3.5" />
          </button>
        </div>
      </div>

      {editing && canEdit ? (
        <RowEditor
          item={item}
          disabled={pending}
          onCancel={() => setEditing(false)}
          onSave={(overrides) => {
            setEditing(false);
            decide(null, "accept", overrides);
          }}
        />
      ) : null}
    </div>
  );
}

function MetaChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-ds-surface px-1.5 py-0 text-[10px] text-ds-text-muted">
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * Drawer latéral droit qui affiche le contexte source (email, meeting,
 * facture) sans quitter /inbox. Fetch à la demande à chaque changement
 * d'item — pas de préchargement pour éviter de gonfler la payload initiale.
 */
function PreviewSheet({ item, onClose }: { item: InboxItem | null; onClose: () => void }) {
  const [data, setData] = useState<InboxPreview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item) return;
    // Les rapprochements Dougs ne passent pas par le fetch preview :
    // toutes les infos utiles sont déjà sur l'item, et on n'a pas de
    // corps textuel à charger. On construit un preview synthétique.
    if (item.source === "reconciliation") {
      setData({
        source: "reconciliation",
        title: item.title,
        subtitle: item.detail,
        externalHref: item.href,
        meta: [
          ...(item.meta.projectName ? [{ label: "Projet", value: item.meta.projectName }] : []),
          ...(item.meta.entityName ? [{ label: "Client", value: item.meta.entityName }] : []),
        ],
        bodyText: null,
      });
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setData(null);
    loadInboxPreview({ source: item.source, sourceId: item.sourceId })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item]);

  const open = !!item;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent className="w-[440px]">
        <SheetHeader
          kind={item ? SOURCE_LABEL[item.source] : undefined}
          actions={
            data?.externalHref ? (
              <Link
                href={data.externalHref}
                target={data.externalHref.startsWith("http") ? "_blank" : undefined}
                rel={data.externalHref.startsWith("http") ? "noopener noreferrer" : undefined}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ds-text-muted hover:bg-ds-hover hover:text-ds-text"
                title="Ouvrir en pleine page"
              >
                <ArrowSquareOut weight="bold" className="size-3" />
                Ouvrir
              </Link>
            ) : null
          }
          onClose={onClose}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-4 w-3/4 rounded bg-ds-hover" />
              <div className="h-3 w-1/2 rounded bg-ds-hover" />
              <div className="mt-4 h-24 w-full rounded bg-ds-hover" />
            </div>
          ) : data ? (
            <div className="space-y-4">
              <div>
                <SheetTitle>{data.title}</SheetTitle>
                {data.subtitle ? (
                  <p className="mt-1 text-ds-text-tertiary text-sm">{data.subtitle}</p>
                ) : null}
              </div>

              {data.meta.length > 0 ? (
                <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12px]">
                  {data.meta.map((m) => (
                    <div key={m.label} className="contents">
                      <dt className="text-ds-text-tertiary">{m.label}</dt>
                      <dd className="min-w-0 break-words text-ds-text">{m.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {data.bodyText ? (
                <pre className="whitespace-pre-wrap break-words border-ds-border border-t pt-3 font-sans text-[13px] text-ds-text leading-relaxed">
                  {data.bodyText}
                </pre>
              ) : (
                <p className="border-ds-border border-t pt-3 text-ds-text-tertiary text-sm">
                  Pas d'aperçu disponible pour cette source.
                </p>
              )}
            </div>
          ) : item ? (
            <p className="text-ds-text-tertiary text-sm">
              Impossible de charger l'aperçu (item supprimé ou hors périmètre).
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Éditeur inline appliqué avant validation. Envoie uniquement les champs
 * édités comme `payloadOverride` — le merge est fait côté action serveur
 * sur le payload complet, donc les champs non touchés restent intacts.
 */
function RowEditor({
  item,
  disabled,
  onSave,
  onCancel,
}: {
  item: InboxItem;
  disabled: boolean;
  onSave: (overrides: {
    payloadOverride?: Record<string, unknown>;
    reconciliation?: InboxReconciliation | null;
  }) => void;
  onCancel: () => void;
}) {
  const initialTitle = item.title;
  const [title, setTitle] = useState(initialTitle);
  const [dueDate, setDueDate] = useState(item.meta.dueDate ?? "");
  const [priority, setPriority] = useState(item.meta.priority ?? "");
  const [assigneeName, setAssigneeName] = useState(item.meta.assigneeName ?? "");
  const [contactEmail, setContactEmail] = useState(item.meta.contactEmail ?? "");
  const [entityName, setEntityName] = useState(item.meta.entityName ?? "");
  // Pour contact : on splitte le titre en firstName / lastName.
  const [firstName, lastName] = useMemo(() => {
    if (item.kind !== "contact") return ["", ""] as const;
    const parts = initialTitle.trim().split(/\s+/);
    if (parts.length === 0) return ["", ""] as const;
    if (parts.length === 1) return [parts[0] ?? "", ""] as const;
    const first = parts[0] ?? "";
    const last = parts.slice(1).join(" ");
    return [first, last] as const;
  }, [item.kind, initialTitle]);
  const [firstNameState, setFirstName] = useState(firstName);
  const [lastNameState, setLastName] = useState(lastName);
  // Pour rapprochement : quel candidat lier ? Défaut = celui qu'on avait
  // pré-sélectionné (top score, stocké dans item.reconciliation).
  const initialRecoTargetId = item.reconciliation?.targetId ?? "";
  const [recoTargetId, setRecoTargetId] = useState(initialRecoTargetId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const override: Record<string, unknown> = {};

    if (item.kind === "task" || item.kind === "opportunity") {
      if (title.trim() !== initialTitle) override.title = title.trim();
    }
    if (item.kind === "task") {
      if ((dueDate || null) !== (item.meta.dueDate ?? null)) override.dueDate = dueDate || null;
      if ((priority || null) !== (item.meta.priority ?? null)) override.priority = priority || null;
      if ((assigneeName || null) !== (item.meta.assigneeName ?? null))
        override.assigneeName = assigneeName || null;
    }
    if (item.kind === "entity" || item.kind === "project") {
      if (title.trim() !== initialTitle) override.name = title.trim();
    }
    if (item.kind === "contact") {
      if (firstNameState.trim() !== firstName) override.firstName = firstNameState.trim();
      if (lastNameState.trim() !== lastName) override.lastName = lastNameState.trim();
      if ((contactEmail || null) !== (item.meta.contactEmail ?? null))
        override.email = contactEmail || null;
      if ((entityName || null) !== (item.meta.entityName ?? null))
        override.entityName = entityName || null;
    }
    if (item.kind === "category_tag") {
      if (title.trim() !== initialTitle) override.name = title.trim();
    }

    // Rapprochement : si le user a changé de candidat, on override la
    // reconciliation avec le candidat sélectionné.
    let recoOverride: InboxReconciliation | null | undefined;
    if (item.kind === "quote_reconciliation" || item.kind === "invoice_reconciliation") {
      const picked = item.reconciliationCandidates?.find(
        (c) => c.reconciliation.targetId === recoTargetId,
      );
      if (picked) recoOverride = picked.reconciliation;
    }

    onSave({
      payloadOverride: Object.keys(override).length > 0 ? override : undefined,
      reconciliation: recoOverride,
    });
  }

  const isTask = item.kind === "task";
  const isOpportunity = item.kind === "opportunity";
  const isContact = item.kind === "contact";
  const isEntityOrProject = item.kind === "entity" || item.kind === "project";
  const isCategoryTag = item.kind === "category_tag";
  const isReconciliation =
    item.kind === "quote_reconciliation" || item.kind === "invoice_reconciliation";
  const candidates = item.reconciliationCandidates ?? [];

  return (
    <form onSubmit={submit} className="border-ds-border border-t bg-ds-surface px-4 py-3.5">
      <div className="grid gap-2.5 sm:grid-cols-2">
        {(isTask || isOpportunity) && (
          <Field label="Titre" full>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="editor-input"
            />
          </Field>
        )}
        {isEntityOrProject && (
          <Field label="Nom" full>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="editor-input"
            />
          </Field>
        )}
        {isContact && (
          <>
            <Field label="Prénom">
              <input
                type="text"
                value={firstNameState}
                onChange={(e) => setFirstName(e.target.value)}
                className="editor-input"
              />
            </Field>
            <Field label="Nom">
              <input
                type="text"
                value={lastNameState}
                onChange={(e) => setLastName(e.target.value)}
                className="editor-input"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="editor-input"
                placeholder="hello@…"
              />
            </Field>
            <Field label="Entité">
              <input
                type="text"
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                className="editor-input"
                placeholder="Nom d'organisation"
              />
            </Field>
          </>
        )}
        {isTask && (
          <>
            <Field label="Échéance">
              <input
                type="date"
                value={dueDate ?? ""}
                onChange={(e) => setDueDate(e.target.value)}
                className="editor-input"
              />
            </Field>
            <Field label="Priorité">
              <select
                value={priority ?? ""}
                onChange={(e) => setPriority(e.target.value)}
                className="editor-input"
              >
                <option value="">—</option>
                <option value="urgent">Urgent</option>
                <option value="high">Haute</option>
                <option value="normal">Normale</option>
                <option value="low">Basse</option>
              </select>
            </Field>
            <Field label="Assigné à" full>
              <input
                type="text"
                value={assigneeName}
                onChange={(e) => setAssigneeName(e.target.value)}
                className="editor-input"
                placeholder="Nom lisible"
              />
            </Field>
          </>
        )}
        {isCategoryTag && (
          <Field label="Nom du tag" full>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="editor-input"
            />
          </Field>
        )}
        {isReconciliation && candidates.length > 0 && (
          <Field label="Rattacher à" full>
            <div className="flex flex-col gap-1">
              {candidates.map((c) => {
                const id = `${item.id}-cand-${c.reconciliation.targetId}`;
                const scorePct = Math.round(c.score * 100);
                const amountLabel = new Intl.NumberFormat("fr-FR", {
                  style: "currency",
                  currency: "EUR",
                  maximumFractionDigits: 0,
                }).format(c.amountHt);
                return (
                  <label
                    key={id}
                    htmlFor={id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors",
                      c.reconciliation.targetId === recoTargetId
                        ? "border-primary-500 bg-primary-50 text-primary-900"
                        : "border-ds-border bg-ds-app hover:border-ds-border-strong",
                    )}
                  >
                    <input
                      id={id}
                      type="radio"
                      name={`${item.id}-reco`}
                      value={c.reconciliation.targetId}
                      checked={c.reconciliation.targetId === recoTargetId}
                      onChange={() => setRecoTargetId(c.reconciliation.targetId)}
                      className="size-3"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {c.label}
                      {c.entityName ? (
                        <span className="ml-1.5 text-ds-text-tertiary">· {c.entityName}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-ds-text-muted tabular-nums">
                      {amountLabel}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0 font-mono text-[10px]",
                        scorePct >= 80
                          ? "bg-tint-green-bg text-tint-green-text"
                          : scorePct >= 55
                            ? "bg-tint-yellow-bg text-tint-yellow-text"
                            : "bg-tint-gray-bg text-tint-gray-text",
                      )}
                    >
                      {scorePct}%
                    </span>
                  </label>
                );
              })}
            </div>
          </Field>
        )}
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="rounded-md px-2.5 py-1 text-[12px] text-ds-text-muted hover:text-ds-text disabled:opacity-40"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-md border border-tint-green-dot bg-tint-green-bg px-2.5 py-1 font-medium text-[12px] text-tint-green-text transition-colors hover:bg-tint-green-dot hover:text-white disabled:opacity-40"
        >
          <Check weight="bold" className="size-3" />
          {isReconciliation ? "Rattacher" : isCategoryTag ? "Appliquer" : "Enregistrer et créer"}
        </button>
      </div>

      <style jsx>{`
        .editor-input {
          width: 100%;
          background: var(--ds-app);
          color: var(--ds-text);
          border: 1px solid var(--ds-border);
          border-radius: 6px;
          padding: 5px 8px;
          font-size: 12px;
          line-height: 1.3;
          outline: none;
        }
        .editor-input:focus {
          border-color: var(--ds-primary-500, currentColor);
        }
      `}</style>
    </form>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1", full && "sm:col-span-2")}>
      <span className="font-medium text-[10px] text-ds-text-tertiary uppercase tracking-wider">
        {label}
      </span>
      {children}
    </div>
  );
}
