"use client";

import { loadInboxHistory, revertInboxItem, updateInboxHistoryItem } from "@/lib/actions/inbox";
import type { InboxExtractionKind } from "@/lib/db/queries/inbox";
import type {
  InboxHistoryData,
  InboxHistoryItem,
  InboxHistorySource,
  InboxHistoryStatus,
} from "@/lib/db/queries/inbox-history";
import { cn } from "@/lib/utils";
import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  Buildings,
  CalendarBlank,
  Check,
  ClockCounterClockwise,
  Envelope,
  MagnifyingGlass,
  PencilSimple,
  Star,
  User,
  Warning,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  KINDS,
  KIND_BY_KEY,
  MetaChip,
  PRIORITY_STYLE,
  SOURCE_ICON,
  formatDueDate,
  projectTint,
} from "./kind-styles";

type StatusFilter = "all" | InboxHistoryStatus;
type SourceFilter = "all" | InboxHistorySource;
type KindFilter = "all" | InboxExtractionKind;

const PAGE_SIZE = 40;

const STATUS_STYLE: Record<
  InboxHistoryStatus,
  { label: string; bg: string; text: string; icon: typeof Check }
> = {
  accepted: {
    label: "Validé",
    bg: "var(--ds-tint-green-bg)",
    text: "var(--ds-tint-green-text)",
    icon: Check,
  },
  rejected: {
    label: "Rejeté",
    bg: "var(--ds-tint-red-bg)",
    text: "var(--ds-tint-red-text)",
    icon: X,
  },
  error: {
    label: "Erreur",
    bg: "var(--ds-tint-orange-bg)",
    text: "var(--ds-tint-orange-text)",
    icon: Warning,
  },
};

const SOURCE_FILTERS: { key: SourceFilter; label: string }[] = [
  { key: "all", label: "Toutes sources" },
  { key: "email", label: "Email" },
  { key: "meeting", label: "Meeting" },
  { key: "filing", label: "Factures" },
];

/**
 * Historique des décisions prises depuis /inbox. Sert à une seule
 * chose : retrouver une décision et la corriger — éditer le record
 * créé, ou remettre la question en attente.
 */
export function InboxHistoryView({ initial }: { initial: InboxHistoryData }) {
  const router = useRouter();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<InboxHistoryData>(initial);
  const [items, setItems] = useState<InboxHistoryItem[]>(initial.items);
  const [loading, setLoading] = useState(false);
  // Garde-fou anti-course : seule la réponse de la dernière requête
  // émise a le droit d'écrire dans le state.
  const requestSeq = useRef(0);
  // Le premier rendu affiche déjà `initial` — pas de refetch à vide.
  const mounted = useRef(false);

  // Debounce de la recherche : on ne repart en base qu'une fois la
  // frappe stabilisée.
  useEffect(() => {
    const t = setTimeout(() => setQuery(rawQuery), 300);
    return () => clearTimeout(t);
  }, [rawQuery]);

  // Tout changement de filtre repart de la première page.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    loadInboxHistory({ status, source, kind, q: query, limit: PAGE_SIZE, offset: 0 }).then(
      (res) => {
        if (seq !== requestSeq.current) return;
        setLoading(false);
        if (!res) {
          toast.error("Session expirée — recharge la page.");
          return;
        }
        setData(res);
        setItems(res.items);
      },
    );
  }, [status, source, kind, query]);

  /** Page suivante, filtres inchangés — les lignes s'ajoutent à la suite. */
  async function loadMore() {
    const seq = ++requestSeq.current;
    setLoading(true);
    const res = await loadInboxHistory({
      status,
      source,
      kind,
      q: query,
      limit: PAGE_SIZE,
      offset: items.length,
    });
    if (seq !== requestSeq.current) return;
    setLoading(false);
    if (!res) {
      toast.error("Session expirée — recharge la page.");
      return;
    }
    setData(res);
    setItems((prev) => [...prev, ...res.items]);
  }

  /** Retire une ligne de la liste courante après un revert réussi. */
  function dropItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setData((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }));
  }

  function patchItem(id: string, patch: Partial<InboxHistoryItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  const allStatusTabs: { key: StatusFilter; label: string; count: number }[] = [
    {
      key: "all",
      label: "Tout",
      count: data.byStatus.accepted + data.byStatus.rejected + data.byStatus.error,
    },
    { key: "accepted", label: "Validés", count: data.byStatus.accepted },
    { key: "rejected", label: "Rejetés", count: data.byStatus.rejected },
    { key: "error", label: "Erreurs", count: data.byStatus.error },
  ];
  // Un statut vide ne mérite pas d'onglet — sauf s'il est sélectionné,
  // sinon on perdrait le moyen d'en sortir.
  const statusTabs = allStatusTabs.filter(
    (t) => t.key === "all" || t.count > 0 || t.key === status,
  );

  const kindTabs = KINDS.filter((k) => (data.byKind[k.key] ?? 0) > 0 || k.key === kind);

  return (
    <div className="flex flex-col gap-4">
      {/* Recherche + filtre statut */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-[220px] flex-1 items-center">
          <MagnifyingGlass
            weight="bold"
            className="pointer-events-none absolute left-2.5 size-3.5 text-ds-text-tertiary"
          />
          <input
            type="search"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Rechercher dans l'historique (titre, projet, expéditeur…)"
            aria-label="Rechercher dans l'historique"
            className="w-full rounded-md border border-ds-border bg-ds-app py-1.5 pr-2.5 pl-8 text-[12px] text-ds-text outline-none placeholder:text-ds-text-tertiary focus:border-primary-500"
          />
        </label>
        {statusTabs.map((t) => {
          const active = t.key === status;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatus(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition-colors",
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

      {/* Filtres par type d'extraction */}
      <div className="-mx-1 flex flex-wrap gap-1.5 overflow-x-auto px-1">
        <FilterPill
          active={kind === "all"}
          label="Tous types"
          count={data.byKind ? Object.values(data.byKind).reduce((a, b) => a + b, 0) : 0}
          onClick={() => setKind("all")}
        />
        {kindTabs.map((k) => (
          <FilterPill
            key={k.key}
            active={kind === k.key}
            label={k.label}
            icon={<k.icon weight="duotone" className="size-3" />}
            count={data.byKind[k.key] ?? 0}
            onClick={() => setKind(k.key)}
          />
        ))}
      </div>

      {/* Sous-filtre par source */}
      <div className="flex flex-wrap items-center gap-2 border-ds-border border-b pb-3">
        <span className="text-[11px] text-ds-text-tertiary uppercase tracking-wider">Source</span>
        {SOURCE_FILTERS.map((t) => {
          const active = t.key === source;
          const count =
            t.key === "all"
              ? data.bySource.email + data.bySource.meeting + data.bySource.filing
              : data.bySource[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSource(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] transition-colors",
                active
                  ? "bg-ds-surface font-medium text-ds-text"
                  : "text-ds-text-muted hover:text-ds-text",
              )}
            >
              {t.label}
              <span className="font-mono text-[10px] text-ds-text-tertiary">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Liste */}
      <div
        className={cn(
          "overflow-hidden rounded-[10px] border border-ds-border bg-ds-app",
          loading && "opacity-60",
        )}
      >
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
            <div className="rounded-full bg-ds-hover p-2.5">
              <ClockCounterClockwise weight="duotone" className="size-5 text-ds-text-tertiary" />
            </div>
            <p className="text-ds-text-tertiary text-sm">
              {loading ? "Chargement…" : "Aucune décision ne correspond à ces filtres."}
            </p>
          </div>
        ) : (
          items.map((it, i) => (
            <HistoryRow
              key={it.id}
              item={it}
              isLast={i === items.length - 1}
              onReverted={() => {
                dropItem(it.id);
                router.refresh();
              }}
              onUpdated={(patch) => patchItem(it.id, patch)}
            />
          ))
        )}
      </div>

      {data.hasMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadMore()}
            className="rounded-md border border-ds-border bg-ds-app px-3 py-1.5 font-medium text-[12px] text-ds-text-muted transition-colors hover:border-ds-border-strong hover:text-ds-text disabled:opacity-40"
          >
            {loading ? "Chargement…" : `Afficher plus (${data.total - items.length} restantes)`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FilterPill({
  active,
  label,
  count,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
        active
          ? "border-primary-500 bg-primary-500 text-white"
          : "border-ds-border bg-ds-app text-ds-text-muted hover:border-ds-border-strong hover:text-ds-text",
      )}
    >
      {icon}
      {label}
      <span
        className={cn(
          "inline-flex min-w-4 items-center justify-center rounded-full px-1 py-0 font-mono font-semibold text-[10px]",
          active ? "bg-white/25 text-white" : "bg-ds-hover text-ds-text-tertiary",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function HistoryRow({
  item,
  isLast,
  onReverted,
  onUpdated,
}: {
  item: InboxHistoryItem;
  isLast: boolean;
  onReverted: () => void;
  onUpdated: (patch: Partial<InboxHistoryItem>) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const kindDef = KIND_BY_KEY[item.kind];
  const KindIcon = kindDef?.icon ?? User;
  const SourceIcon = SOURCE_ICON[item.source];
  const statusStyle = STATUS_STYLE[item.status];
  const StatusIcon = statusStyle.icon;
  const priorityStyle = item.meta.priority ? PRIORITY_STYLE[item.meta.priority] : undefined;
  const projectDot = item.projectId ? projectTint(item.projectId, item.projectColor) : null;
  const isLinkKind = item.kind === "project_link" || item.kind === "entity_link";
  const revertLabel = item.source === "filing" ? "Relancer le classement" : "Remettre en attente";

  function revert() {
    // Un rattachement, c'est la liaison elle-même : la remettre en
    // attente retire le lien et son libellé Gmail. Un reclassement
    // repart chercher le Drive. Les deux méritent une confirmation ;
    // annuler un simple « créé », non.
    if (
      (isLinkKind || item.source === "filing") &&
      !window.confirm(
        item.source === "filing"
          ? "Relancer le classement de cette facture ?"
          : "Remettre ce rattachement en attente ? La liaison et son libellé Gmail seront retirés.",
      )
    )
      return;
    startTransition(async () => {
      const res = await revertInboxItem({ source: item.source, id: item.sourceId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(item.source === "filing" ? "Classement relancé." : "Remis dans « À traiter ».");
      onReverted();
      router.refresh();
    });
  }

  function saveEdit(payload: Record<string, unknown>, patch: Partial<InboxHistoryItem>) {
    startTransition(async () => {
      const res = await updateInboxHistoryItem({
        source: item.source,
        id: item.sourceId,
        payload,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setEditing(false);
      onUpdated(patch);
      toast.success("Corrigé.");
      router.refresh();
    });
  }

  return (
    <div className={cn(!isLast && "border-ds-border border-b", pending && "opacity-50")}>
      <div className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-ds-hover">
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

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {item.recordHref ? (
              <Link
                href={item.recordHref}
                target={item.recordHref.startsWith("http") ? "_blank" : undefined}
                rel={item.recordHref.startsWith("http") ? "noopener noreferrer" : undefined}
                className="min-w-0 truncate font-medium text-ds-text text-sm hover:underline"
              >
                {item.title}
              </Link>
            ) : (
              <span className="min-w-0 truncate font-medium text-ds-text text-sm">
                {item.title}
              </span>
            )}
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0 text-[10px]"
              style={{ background: statusStyle.bg, color: statusStyle.text }}
            >
              <StatusIcon weight="bold" className="size-2.5" />
              {item.status === "accepted" ? (kindDef?.doneLabel ?? "Validé") : statusStyle.label}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
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

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-ds-text-tertiary">
            <SourceIcon weight="duotone" className="size-3 shrink-0 text-ds-text-muted" />
            <Link href={item.sourceHref} className="truncate hover:underline">
              {item.sourceLabel}
            </Link>
            {item.decidedLabel ? (
              <>
                <span className="text-ds-text-muted">·</span>
                <span className="shrink-0">{item.decidedLabel}</span>
              </>
            ) : null}
            {item.decidedByName ? (
              <>
                <span className="text-ds-text-muted">·</span>
                <span className="shrink-0">par {item.decidedByName}</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex flex-none items-center gap-1.5">
          {item.recordHref ? (
            <Link
              href={item.recordHref}
              target={item.recordHref.startsWith("http") ? "_blank" : undefined}
              rel={item.recordHref.startsWith("http") ? "noopener noreferrer" : undefined}
              aria-label={item.recordLabel ?? "Ouvrir la fiche"}
              title={item.recordLabel ?? "Ouvrir la fiche"}
              className="inline-flex size-7 items-center justify-center rounded-md border border-ds-border bg-ds-app text-ds-text-tertiary transition-colors hover:border-ds-border-strong hover:text-ds-text"
            >
              <ArrowSquareOut weight="bold" className="size-3.5" />
            </Link>
          ) : null}
          {item.editable ? (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              disabled={pending}
              aria-label="Corriger"
              title="Corriger la fiche créée"
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-md border border-ds-border bg-ds-app text-ds-text-tertiary transition-colors hover:border-ds-border-strong hover:text-ds-text disabled:opacity-40",
                editing && "border-primary-500 bg-primary-50 text-primary-700",
              )}
            >
              <PencilSimple weight="bold" className="size-3.5" />
            </button>
          ) : null}
          {item.revertible ? (
            <button
              type="button"
              onClick={revert}
              disabled={pending}
              aria-label={revertLabel}
              title={revertLabel}
              className="inline-flex size-7 items-center justify-center rounded-md border border-ds-border bg-ds-app text-ds-text-tertiary transition-colors hover:border-ds-border-strong hover:text-ds-text disabled:opacity-40"
            >
              <ArrowCounterClockwise weight="bold" className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {editing && item.editable ? (
        <HistoryRowEditor
          item={item}
          disabled={pending}
          onCancel={() => setEditing(false)}
          onSave={saveEdit}
        />
      ) : null}
    </div>
  );
}

/**
 * Correction du record déjà créé. On envoie le payload complet des
 * champs éditables (pas un diff) : côté serveur il est mergé sur le
 * payload d'origine puis réappliqué au record CRM.
 */
function HistoryRowEditor({
  item,
  disabled,
  onSave,
  onCancel,
}: {
  item: InboxHistoryItem;
  disabled: boolean;
  onSave: (payload: Record<string, unknown>, patch: Partial<InboxHistoryItem>) => void;
  onCancel: () => void;
}) {
  const isTask = item.kind === "task";
  const isContact = item.kind === "contact";
  const isEntity = item.kind === "entity";
  const isProjectish = item.kind === "project" || item.kind === "opportunity";

  const [firstName, lastName] = (() => {
    if (!isContact) return ["", ""] as const;
    const parts = item.title.trim().split(/\s+/);
    if (parts.length <= 1) return [parts[0] ?? "", ""] as const;
    return [parts[0] ?? "", parts.slice(1).join(" ")] as const;
  })();

  const [title, setTitle] = useState(item.title);
  const [firstNameState, setFirstName] = useState(firstName);
  const [lastNameState, setLastName] = useState(lastName);
  const [contactEmail, setContactEmail] = useState(item.meta.contactEmail ?? "");
  const [entityName, setEntityName] = useState(item.meta.entityName ?? "");
  const [dueDate, setDueDate] = useState(item.meta.dueDate ?? "");
  const [priority, setPriority] = useState(item.meta.priority ?? "");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {};
    const patch: Partial<InboxHistoryItem> = {};
    const meta = { ...item.meta };

    if (isTask) {
      payload.title = title.trim();
      payload.dueDate = dueDate || null;
      payload.priority = priority || null;
      patch.title = title.trim();
      meta.dueDate = dueDate || null;
      meta.priority = priority || null;
    } else if (isContact) {
      payload.firstName = firstNameState.trim();
      payload.lastName = lastNameState.trim();
      payload.email = contactEmail.trim() || null;
      payload.entityName = entityName.trim() || null;
      // `entityId` est résolu côté serveur depuis `entityName` — on le
      // remet à null pour que l'ancien id ne gagne pas sur le nom saisi.
      payload.entityId = null;
      patch.title = `${firstNameState.trim()} ${lastNameState.trim()}`.trim();
      meta.contactEmail = contactEmail.trim() || null;
      meta.entityName = entityName.trim() || null;
    } else if (isEntity) {
      payload.name = title.trim();
      patch.title = title.trim();
    } else if (isProjectish) {
      payload.name = title.trim();
      // Un proposal `opportunity` porte son nom dans `title` — on tient
      // les deux clés à jour pour que la relecture reste cohérente.
      if (item.kind === "opportunity") payload.title = title.trim();
      payload.entityName = entityName.trim() || null;
      payload.entityId = null;
      patch.title = title.trim();
      meta.entityName = entityName.trim() || null;
    }

    patch.meta = meta;
    onSave(payload, patch);
  }

  return (
    <form onSubmit={submit} className="border-ds-border border-t bg-ds-surface px-4 py-3.5">
      <p className="mb-2.5 text-[11px] text-ds-text-tertiary">
        La correction s'applique à la fiche déjà créée — pas de doublon.
      </p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {(isTask || isEntity || isProjectish) && (
          <Field label={isTask ? "Titre" : "Nom"} full>
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
          </>
        )}
        {(isContact || isProjectish) && (
          <Field label="Entité" full={isProjectish}>
            <input
              type="text"
              value={entityName}
              onChange={(e) => setEntityName(e.target.value)}
              className="editor-input"
              placeholder="Nom d'organisation"
            />
          </Field>
        )}
        {isTask && (
          <>
            <Field label="Échéance">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="editor-input"
              />
            </Field>
            <Field label="Priorité">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="editor-input"
              >
                <option value="">—</option>
                <option value="high">Haute</option>
                <option value="normal">Normale</option>
                <option value="low">Basse</option>
              </select>
            </Field>
          </>
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
          Enregistrer
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
