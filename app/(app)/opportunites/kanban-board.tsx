"use client";

import { UserAvatar } from "@/components/user/user-avatar";
import { moveOpportunityStatus } from "@/lib/actions/opportunities";
import { formatDate, formatEuro } from "@/lib/format";
import {
  type OpportunityStatus,
  opportunityStatusEnum,
  opportunityStatusLabels,
} from "@/lib/schemas/opportunities";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

export type KanbanItem = {
  id: string;
  title: string;
  status: OpportunityStatus;
  valueAmount: string | null;
  probability: number | null;
  followUpDate: string | null;
  entityId: string | null;
  entityName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerAvatarUrl: string | null;
};

/**
 * Couleurs par statut. Classes Tailwind statiques (le scanner les détecte
 * dans cette source). Pas de string concat dynamique.
 */
const STATUS_STYLE: Record<
  OpportunityStatus,
  {
    column: string; // bord gauche + fond léger de la colonne
    header: string; // header column accent
    headerText: string;
    cardBorder: string; // bord gauche carte
    dot: string; // pastille indicateur
    badge: string; // badge montant inline
  }
> = {
  not_started: {
    column: "border-slate-300 dark:border-slate-700",
    header: "bg-slate-100 dark:bg-slate-900/40",
    headerText: "text-slate-700 dark:text-slate-300",
    cardBorder: "border-l-slate-400",
    dot: "bg-slate-400",
    badge: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
  },
  proposal_sent: {
    column: "border-indigo-300 dark:border-indigo-800",
    header: "bg-indigo-100 dark:bg-indigo-950/50",
    headerText: "text-indigo-700 dark:text-indigo-300",
    cardBorder: "border-l-indigo-500",
    dot: "bg-indigo-500",
    badge: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  },
  to_follow_up: {
    column: "border-amber-300 dark:border-amber-800",
    header: "bg-amber-100 dark:bg-amber-950/50",
    headerText: "text-amber-800 dark:text-amber-300",
    cardBorder: "border-l-amber-500",
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  awaiting_response: {
    column: "border-orange-300 dark:border-orange-800",
    header: "bg-orange-100 dark:bg-orange-950/50",
    headerText: "text-orange-800 dark:text-orange-300",
    cardBorder: "border-l-orange-500",
    dot: "bg-orange-500",
    badge: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  },
  won: {
    column: "border-emerald-300 dark:border-emerald-800",
    header: "bg-emerald-100 dark:bg-emerald-950/50",
    headerText: "text-emerald-800 dark:text-emerald-300",
    cardBorder: "border-l-emerald-500",
    dot: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  lost: {
    column: "border-rose-300 dark:border-rose-800",
    header: "bg-rose-100 dark:bg-rose-950/50",
    headerText: "text-rose-800 dark:text-rose-300",
    cardBorder: "border-l-rose-500",
    dot: "bg-rose-500",
    badge: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  },
};

export function KanbanBoard({ items }: { items: KanbanItem[] }) {
  const [optimisticItems, applyMove] = useOptimistic<
    KanbanItem[],
    { id: string; status: OpportunityStatus }
  >(items, (state, payload) =>
    state.map((it) => (it.id === payload.id ? { ...it, status: payload.status } : it)),
  );
  const [, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const columns = opportunityStatusEnum.options;

  function onDragEnd(event: DragEndEvent) {
    const id = String(event.active.id);
    const overId = event.over?.id;
    if (!overId) return;
    const nextStatus = String(overId) as OpportunityStatus;
    const current = optimisticItems.find((it) => it.id === id);
    if (!current || current.status === nextStatus) return;

    startTransition(async () => {
      applyMove({ id, status: nextStatus });
      const result = await moveOpportunityStatus({ id, status: nextStatus });
      if (!result.ok) {
        toast.error(result.message);
        applyMove({ id, status: current.status });
      }
    });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {columns.map((status) => (
          <Column
            key={status}
            status={status}
            items={optimisticItems.filter((it) => it.status === status)}
          />
        ))}
      </div>
    </DndContext>
  );
}

function Column({ status, items }: { status: OpportunityStatus; items: KanbanItem[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const total = items.reduce((acc, it) => acc + Number(it.valueAmount ?? 0), 0);
  const style = STATUS_STYLE[status];

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[220px] flex-col rounded-lg border-2 bg-card transition-all ${style.column} ${
        isOver ? "scale-[1.005] shadow-lg ring-2 ring-foreground/20" : ""
      }`}
    >
      <div className={`flex items-center justify-between rounded-t-md px-3 py-2 ${style.header}`}>
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${style.dot}`} aria-hidden />
          <p className={`font-semibold text-xs uppercase tracking-wide ${style.headerText}`}>
            {opportunityStatusLabels[status]}
          </p>
        </div>
        <span className={`font-medium text-[11px] ${style.headerText}`}>
          {items.length} · {formatEuro(total)}
        </span>
      </div>
      <ul className="flex flex-1 flex-col gap-2 p-2">
        {items.map((item) => (
          <Card key={item.id} item={item} />
        ))}
        {items.length === 0 ? (
          <li className="flex items-center justify-center rounded-md border border-dashed bg-background/50 px-3 py-8 text-center text-muted-foreground text-xs">
            Glisser ici
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function Card({ item }: { item: KanbanItem }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const colors = STATUS_STYLE[item.status];

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group cursor-grab rounded-md border border-l-4 bg-background p-3 shadow-sm transition-shadow active:cursor-grabbing ${colors.cardBorder} ${
        isDragging ? "opacity-60 shadow-lg ring-2 ring-foreground/20" : "hover:shadow-md"
      }`}
    >
      <Link
        href={`/opportunites/${item.id}`}
        onClick={(e) => {
          if (isDragging) e.preventDefault();
        }}
        className="block space-y-2"
      >
        <p className="font-medium text-sm leading-tight">{item.title}</p>

        {item.entityName ? (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Building2 className="size-3" />
            <span className="truncate">{item.entityName}</span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {item.valueAmount ? (
            <span className={`rounded px-1.5 py-0.5 font-medium text-[11px] ${colors.badge}`}>
              {formatEuro(Number(item.valueAmount))}
            </span>
          ) : null}
          {item.probability != null ? (
            <span className="text-[11px] text-muted-foreground">{item.probability}%</span>
          ) : null}
          {item.followUpDate ? (
            <span className="text-[11px] text-muted-foreground">
              ↻ {formatDate(item.followUpDate)}
            </span>
          ) : null}
          {item.ownerId ? (
            <span className="ml-auto">
              <UserAvatar size="xs" name={item.ownerName} avatarUrl={item.ownerAvatarUrl} />
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
