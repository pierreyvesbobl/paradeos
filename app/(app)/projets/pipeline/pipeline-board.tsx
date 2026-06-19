"use client";

import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user/user-avatar";
import { patchProject, quickCreateProject } from "@/lib/actions/projects";
import { formatDate, formatEuro } from "@/lib/format";
import { type ProjectStatus, projectStatusLabels } from "@/lib/schemas/projects";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Buildings, CalendarBlank, Clock, Plus } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

export type PipelineItem = {
  id: string;
  name: string;
  status: ProjectStatus;
  /** Montant à afficher (Dougs prend le pas sur la saisie manuelle). */
  valueAmount: string | null;
  /** "dougs" si le montant vient d'un devis Dougs lié, sinon "manual". */
  valueSource: "dougs" | "manual";
  dougsQuoteReference: string | null;
  probability: number | null;
  followUpDate: string | null;
  entityName: string | null;
  ownerName: string | null;
  ownerAvatarUrl: string | null;
};

const COLUMNS: ProjectStatus[] = [
  "not_started",
  "to_follow_up",
  "awaiting_response",
  "won",
  "lost",
];

type Tint = "gray" | "yellow" | "orange" | "green" | "red";

const STATUS_TINT: Record<ProjectStatus, Tint> = {
  not_started: "gray",
  to_follow_up: "yellow",
  awaiting_response: "orange",
  won: "green",
  lost: "red",
  planning: "gray",
  active: "green",
  on_hold: "gray",
  completed: "green",
  archived: "gray",
};

function tintVars(tint: Tint) {
  return {
    background: `var(--ds-tint-${tint}-bg)`,
    color: `var(--ds-tint-${tint}-text)`,
    "--tint-dot": `var(--ds-tint-${tint}-dot)`,
  } as React.CSSProperties;
}

export function PipelineBoard({ items }: { items: PipelineItem[] }) {
  const router = useRouter();
  const [optimisticItems, applyMove] = useOptimistic<
    PipelineItem[],
    { id: string; status: ProjectStatus }
  >(items, (state, payload) =>
    state.map((it) => (it.id === payload.id ? { ...it, status: payload.status } : it)),
  );
  const [, startTransition] = useTransition();
  const [deliveryCandidate, setDeliveryCandidate] = useState<PipelineItem | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // @dnd-kit utilise un compteur module-level pour ses `aria-describedby`,
  // ce qui crée des mismatches d'hydratation SSR/client. On monte le DnD
  // uniquement après hydratation.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function onDragEnd(event: DragEndEvent) {
    const id = String(event.active.id);
    const overId = event.over?.id;
    if (!overId) return;
    const nextStatus = String(overId) as ProjectStatus;
    const current = optimisticItems.find((it) => it.id === id);
    if (!current || current.status === nextStatus) return;

    startTransition(async () => {
      applyMove({ id, status: nextStatus });
      const result = await patchProject({ id, status: nextStatus });
      if (!result.ok) {
        toast.error(result.message);
        applyMove({ id, status: current.status });
        return;
      }
      if (nextStatus === "won" && current.status !== "won") {
        queueMicrotask(() => setDeliveryCandidate({ ...current, status: "won" }));
      }
    });
  }

  if (!mounted) {
    return <StaticBoard items={optimisticItems} />;
  }

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="-mx-6 overflow-x-auto px-6 pb-2">
          <div className="flex items-start gap-4">
            {COLUMNS.map((status) => (
              <Column
                key={status}
                status={status}
                items={optimisticItems.filter((it) => it.status === status)}
              />
            ))}
          </div>
        </div>
      </DndContext>
      {deliveryCandidate ? (
        <StartDeliveryDialog
          project={deliveryCandidate}
          onClose={() => setDeliveryCandidate(null)}
          onSwitched={() => router.refresh()}
        />
      ) : null}
    </>
  );
}

function Column({ status, items }: { status: ProjectStatus; items: PipelineItem[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const tint = STATUS_TINT[status];
  const total = items.reduce((acc, it) => acc + Number(it.valueAmount ?? 0), 0);
  return (
    <section
      ref={setNodeRef}
      style={tintVars(tint)}
      className={`flex w-[300px] shrink-0 flex-col gap-2.5 rounded-xl p-2.5 transition-[box-shadow] ${
        isOver ? "shadow-[inset_0_0_0_2px_var(--tint-dot)]" : ""
      }`}
    >
      <ColumnHeader title={projectStatusLabels[status]} count={items.length} total={total} />
      <ul className="flex flex-col gap-2.5">
        {items.map((it) => (
          <Card key={it.id} item={it} />
        ))}
      </ul>
      <ColumnAddForm status={status} />
    </section>
  );
}

function ColumnHeader({
  title,
  count,
  total,
}: {
  title: string;
  count: number;
  total: number;
}) {
  return (
    <header className="flex items-center gap-2.5 px-1 pt-0.5">
      <span
        className="inline-flex size-6 flex-none items-center justify-center rounded-full bg-[var(--ds-bg-app)] font-bold text-[12px] shadow-sm"
        style={{ color: "inherit" }}
      >
        {count}
      </span>
      <h2 className="whitespace-nowrap font-semibold text-[15px] leading-none">{title}</h2>
      <span className="flex-1" />
      {total > 0 ? <span className="font-mono text-xs opacity-80">{formatEuro(total)}</span> : null}
      <Plus size={14} weight="bold" className="opacity-75" />
    </header>
  );
}

function Card({ item }: { item: PipelineItem }) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
  });
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 50,
      }
    : undefined;

  const probability =
    item.probability != null ? Math.max(0, Math.min(100, item.probability)) : null;
  const overdueDays = item.followUpDate ? computeOverdueDays(item.followUpDate) : 0;

  // Navigation programmatique : on n'enveloppe plus la carte dans un <Link>
  // pour pouvoir embarquer un picker date (interactif) sans HTML invalide
  // (<button> dans <a>). On garde la sémantique role="link" + onClick.
  function openProject(e: React.MouseEvent) {
    if (isDragging) {
      e.preventDefault();
      return;
    }
    // Ouverture cmd/ctrl-clic = nouvel onglet (comme un vrai Link).
    if (e.metaKey || e.ctrlKey) {
      window.open(`/projets/${item.id}`, "_blank");
      return;
    }
    router.push(`/projets/${item.id}`);
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`group cursor-grab rounded-[10px] border border-border/70 bg-[var(--ds-bg-app)] shadow-[0_1px_2px_rgba(15,15,15,0.04)] transition-shadow active:cursor-grabbing ${
        isDragging
          ? "opacity-70 shadow-lg ring-2 ring-foreground/20"
          : "hover:-translate-y-px hover:shadow-sm"
      }`}
    >
      {/** biome-ignore lint/a11y/useSemanticElements: <a> imbriquerait <button>
       *  (le DateInput-trigger). On garde un div role="link" + onClick. */}
      <div
        role="link"
        tabIndex={0}
        onClick={openProject}
        onKeyDown={(e) => {
          if (e.key === "Enter") router.push(`/projets/${item.id}`);
        }}
        className="block space-y-2.5 px-3 py-3"
      >
        <p className="font-medium text-foreground text-sm leading-snug">{item.name}</p>

        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-muted-foreground">
            <Buildings
              size={14}
              weight="duotone"
              className="flex-none text-[var(--ds-text-tertiary)]"
            />
            <span className="truncate">{item.entityName ?? "—"}</span>
          </div>
          {item.ownerName ? (
            <UserAvatar
              name={item.ownerName}
              avatarUrl={item.ownerAvatarUrl}
              size="sm"
              className="size-[26px]"
            />
          ) : null}
        </div>

        <div className="h-px bg-border/70" />

        <div className="flex items-center gap-2">
          {item.valueAmount ? (
            <span
              className={
                item.valueSource === "dougs"
                  ? "font-medium font-mono text-[13px] text-indigo-700 dark:text-indigo-300"
                  : "font-medium font-mono text-[13px] text-foreground"
              }
              title={
                item.valueSource === "dougs"
                  ? `Depuis Dougs ${item.dougsQuoteReference ?? ""}`
                  : "Montant manuel"
              }
            >
              {formatEuro(Number(item.valueAmount))}
              {item.valueSource === "dougs" ? " ⓘ" : ""}
            </span>
          ) : (
            <span className="text-[12px] text-[var(--ds-text-tertiary)]">Montant à définir</span>
          )}

          <span className="flex-1" />

          <FollowUpEditor id={item.id} value={item.followUpDate} overdueDays={overdueDays} />

          {probability != null ? (
            <span className="inline-flex flex-none items-center gap-1.5">
              <span className="relative h-[5px] w-10 overflow-hidden rounded-full bg-[var(--ds-bg-press)]">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-[var(--ds-primary-400)]"
                  style={{ width: `${probability}%` }}
                />
              </span>
              <span className="font-semibold text-[11px] text-[var(--ds-text-tertiary)] tabular-nums">
                {probability}%
              </span>
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * Picker date de relance — sert de remplaçant au badge overdue/lecture.
 *
 *  - aucune date    → bouton subtil "+ Relance" (visible au hover de la carte)
 *  - date à venir   → pill neutre avec date formatée + icône calendar
 *  - date dépassée  → pill rouge "Xj" comme avant
 *
 * Stop la propagation du `pointerDown`/`click` pour éviter de déclencher
 * le drag dnd-kit ou la navigation vers la fiche projet.
 */
function FollowUpEditor({
  id,
  value,
  overdueDays,
}: {
  id: string;
  value: string | null;
  overdueDays: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<string | null>(value);
  useEffect(() => setOptimistic(value), [value]);

  function commit(next: string) {
    const nextOrNull = next === "" ? null : next;
    if (nextOrNull === optimistic) return;
    const prev = optimistic;
    setOptimistic(nextOrNull);
    startTransition(async () => {
      const res = await patchProject({ id, followUpDate: nextOrNull });
      if (!res.ok) {
        setOptimistic(prev);
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  // Évite que le clic descende sur le wrapper "block" (qui déclenche la
  // navigation) ou sur le `<li>` (qui déclenche le drag dnd-kit).
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <span
      onPointerDown={stop}
      onMouseDown={stop}
      onKeyDown={stop}
      onClick={stop}
      className="inline-flex flex-none"
    >
      <DateInput
        value={optimistic ?? ""}
        onValueChange={commit}
        disabled={pending}
        trigger={
          optimistic && overdueDays > 0 ? (
            <button
              type="button"
              disabled={pending}
              title={`Relance ${formatDate(optimistic)} — en retard de ${overdueDays}j`}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[11px] transition-opacity hover:opacity-80"
              style={{
                background: "var(--ds-tint-red-bg)",
                color: "var(--ds-tint-red-text)",
              }}
            >
              <Clock size={12} weight="duotone" />
              {overdueDays}j
            </button>
          ) : optimistic ? (
            <button
              type="button"
              disabled={pending}
              title={`Relance prévue le ${formatDate(optimistic)}`}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--ds-bg-hover)] px-2 py-0.5 font-medium text-[11px] text-muted-foreground transition-opacity hover:opacity-80"
            >
              <CalendarBlank size={12} weight="duotone" />
              {formatDate(optimistic)}
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              title="Définir une date de relance"
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium text-[11px] text-[var(--ds-text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--ds-bg-hover)] group-hover:opacity-100"
            >
              <CalendarBlank size={12} weight="duotone" />
              Relance
            </button>
          )
        }
      />
    </span>
  );
}

function computeOverdueDays(date: string): number {
  const followUp = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const followUpDay = new Date(followUp.getFullYear(), followUp.getMonth(), followUp.getDate());
  return Math.floor((today.getTime() - followUpDay.getTime()) / 86400000);
}

/**
 * Rendu statique non-DnD pour le pré-hydratation. Mêmes colonnes / cartes
 * mais sans `useDraggable`/`useDroppable` (qui génèrent des IDs aria
 * non-déterministes en SSR).
 */
function StaticBoard({ items }: { items: PipelineItem[] }) {
  return (
    <div className="-mx-6 overflow-x-auto px-6 pb-2">
      <div className="flex items-start gap-4">
        {COLUMNS.map((status) => {
          const colItems = items.filter((it) => it.status === status);
          const total = colItems.reduce((acc, it) => acc + Number(it.valueAmount ?? 0), 0);
          const tint = STATUS_TINT[status];
          return (
            <section
              key={status}
              style={tintVars(tint)}
              className="flex w-[300px] shrink-0 flex-col gap-2.5 rounded-xl p-2.5"
            >
              <ColumnHeader
                title={projectStatusLabels[status]}
                count={colItems.length}
                total={total}
              />
              <ul className="flex flex-col gap-2.5">
                {colItems.map((it) => (
                  <li
                    key={it.id}
                    className="rounded-[10px] border border-border/70 bg-[var(--ds-bg-app)] px-3 py-3 shadow-[0_1px_2px_rgba(15,15,15,0.04)]"
                  >
                    <p className="font-medium text-foreground text-sm leading-snug">{it.name}</p>
                    {it.entityName ? (
                      <div className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        <Buildings
                          size={14}
                          weight="duotone"
                          className="text-[var(--ds-text-tertiary)]"
                        />
                        <span className="truncate">{it.entityName}</span>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ColumnAddForm({ status }: { status: ProjectStatus }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await quickCreateProject({ name: trimmed, kind: "client", status });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`« ${res.data.name} » créé.`);
      setName("");
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] border-dashed py-2.5 font-medium text-[13px] opacity-85 transition-opacity hover:opacity-100"
        style={{ borderColor: "var(--tint-dot)", color: "inherit" }}
      >
        <Plus size={14} weight="bold" />
        Ajouter un deal
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-1.5 rounded-[10px] border border-border/70 bg-[var(--ds-bg-app)] p-2"
    >
      <input
        type="text"
        // biome-ignore lint/a11y/noAutofocus: focus voulu après ouverture du form
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setName("");
            setOpen(false);
          }
        }}
        onBlur={() => {
          if (!name.trim()) setOpen(false);
        }}
        placeholder="Titre du deal…"
        disabled={pending}
        className="w-full rounded-sm bg-transparent px-1.5 py-0.5 text-foreground text-sm outline-none focus-visible:bg-muted/50"
      />
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => {
            setName("");
            setOpen(false);
          }}
          disabled={pending}
          className="rounded-sm px-2 py-0.5 text-muted-foreground text-xs hover:bg-muted"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="rounded-sm bg-foreground px-2 py-0.5 text-background text-xs disabled:opacity-50"
        >
          {pending ? "…" : "Ajouter"}
        </button>
      </div>
    </form>
  );
}

function StartDeliveryDialog({
  project,
  onClose,
  onSwitched,
}: {
  project: PipelineItem;
  onClose: () => void;
  onSwitched: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function startDelivery() {
    startTransition(async () => {
      const res = await patchProject({ id: project.id, status: "active" });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Delivery démarrée.");
      onClose();
      onSwitched();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Démarrer la delivery ?</DialogTitle>
          <DialogDescription>
            « {project.name} » est passé en <strong>Signé</strong>. Tu peux maintenant le basculer
            en phase delivery (statut <strong>Actif</strong>) — il sortira du pipeline et apparaîtra
            dans la liste des projets actifs.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Plus tard
          </Button>
          <Button type="button" onClick={startDelivery} disabled={pending}>
            {pending ? "…" : "Démarrer la delivery"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
