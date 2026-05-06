"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/user/user-avatar";
import {
  convertOpportunityToProject,
  createOpportunity,
  moveOpportunityStatus,
} from "@/lib/actions/opportunities";
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
import { Building2, Clock, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
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
  projectId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerAvatarUrl: string | null;
};

/**
 * Couleurs par statut. Inspiré Trello : pas de bandeau plein dans le
 * header, juste un dot d'accent + un label tag de couleur en haut de
 * carte. Le reste de la colonne reste neutre.
 */
const STATUS_STYLE: Record<OpportunityStatus, { dot: string; tag: string; amount: string }> = {
  not_started: {
    dot: "bg-slate-400",
    tag: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    amount: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
  },
  to_follow_up: {
    dot: "bg-amber-500",
    tag: "bg-amber-200 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    amount: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  awaiting_response: {
    dot: "bg-orange-500",
    tag: "bg-orange-200 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    amount: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  },
  won: {
    dot: "bg-emerald-500",
    tag: "bg-emerald-200 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
    amount: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  lost: {
    dot: "bg-rose-500",
    tag: "bg-rose-200 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
    amount: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
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
  // Stocke l'opp à convertir après un drop sur "Signée".
  const [convertCandidate, setConvertCandidate] = useState<KanbanItem | null>(null);

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
        return;
      }
      // Si l'opp passe en "Signée" et n'a pas encore de projet lié,
      // on propose la conversion immédiate.
      if (nextStatus === "won" && current.status !== "won" && !current.projectId) {
        if (!current.entityId) {
          toast.message("Opportunité signée — lie une entité pour créer le projet.");
        } else {
          // Defer hors du transition pour que l'ouverture du dialog
          // ne soit pas marquée comme transition (sinon React peut différer
          // l'affichage le temps que la revalidation se termine).
          queueMicrotask(() => setConvertCandidate({ ...current, status: "won" }));
        }
      }
    });
  }

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="-mx-6 overflow-x-auto px-6 pb-2">
          <div className="flex items-start gap-3">
            {columns.map((status) => (
              <Column
                key={status}
                status={status}
                items={optimisticItems.filter((it) => it.status === status)}
              />
            ))}
          </div>
        </div>
      </DndContext>
      {convertCandidate ? (
        <ConvertDialog opportunity={convertCandidate} onClose={() => setConvertCandidate(null)} />
      ) : null}
    </>
  );
}

function ConvertDialog({
  opportunity,
  onClose,
}: {
  opportunity: KanbanItem;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const suggested = `${opportunity.entityName ?? "Projet"} — ${opportunity.title}`;
  const [name, setName] = useState(suggested);

  function submit() {
    startTransition(async () => {
      const res = await convertOpportunityToProject({
        id: opportunity.id,
        projectName: name.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Projet créé.");
      onClose();
      if (res.data.projectId) {
        router.push(`/projets/${res.data.projectId}`);
      } else {
        router.refresh();
      }
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
          <DialogTitle>Créer le projet associé ?</DialogTitle>
          <DialogDescription>
            L'opportunité « {opportunity.title} » est passée en Signée. On crée le projet client
            (rattaché à {opportunity.entityName ?? "l'entité"}) ? Le temps avant-vente déjà tracké
            restera lié et remontera dans les stats du projet.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="proj-name">Nom du projet</Label>
          <Input
            id="proj-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Plus tard
          </Button>
          <Button type="button" onClick={submit} disabled={pending || name.trim().length === 0}>
            {pending ? "Création…" : "Créer le projet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Column({ status, items }: { status: OpportunityStatus; items: KanbanItem[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const total = items.reduce((acc, it) => acc + Number(it.valueAmount ?? 0), 0);
  const style = STATUS_STYLE[status];

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-xl bg-muted/50 transition-shadow ${
        isOver ? "ring-2 ring-foreground/30" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
          <p className="truncate font-semibold text-foreground text-sm">
            {opportunityStatusLabels[status]}
          </p>
          <span className="text-muted-foreground text-xs">{items.length}</span>
        </div>
        {total > 0 ? (
          <span className="text-muted-foreground text-xs">{formatEuro(total)}</span>
        ) : null}
      </div>
      <ul className="flex flex-col gap-2 px-2 pb-1">
        {items.map((item) => (
          <Card key={item.id} item={item} />
        ))}
      </ul>
      <QuickAddCard status={status} />
    </div>
  );
}

function QuickAddCard({ status }: { status: OpportunityStatus }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  function submit() {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    startTransition(async () => {
      const res = await createOpportunity({ title: trimmed, status });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setTitle("");
      // On laisse l'input ouvert pour enchaîner les ajouts (Trello-like).
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-2 mt-1 mb-2 flex items-center gap-1.5 rounded-md px-2 py-2 text-left text-muted-foreground text-sm transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <Plus className="size-4" />
        Ajouter une carte
      </button>
    );
  }

  return (
    <div className="mx-2 mt-1 mb-2 space-y-1.5 rounded-md border bg-background p-2 shadow-sm">
      <textarea
        ref={textareaRef}
        rows={2}
        value={title}
        disabled={pending}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            setOpen(false);
            setTitle("");
          }
        }}
        placeholder="Titre de l'opportunité…"
        className="block w-full resize-none rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={submit}
          disabled={pending || title.trim().length === 0}
          className="rounded-md bg-foreground px-3 py-1 font-medium text-background text-xs hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "…" : "Ajouter"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTitle("");
          }}
          disabled={pending}
          aria-label="Fermer"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="size-3.5" />
        </button>
      </div>
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
      className={`group cursor-grab rounded-lg border border-border/60 bg-background shadow-sm transition-shadow active:cursor-grabbing ${
        isDragging ? "opacity-70 shadow-lg ring-2 ring-foreground/20" : "hover:shadow-md"
      }`}
    >
      <Link
        href={`/opportunites/${item.id}`}
        onClick={(e) => {
          if (isDragging) e.preventDefault();
        }}
        className="block space-y-2 px-3 py-2.5"
      >
        {/* Tag de couleur en haut, façon labels Trello */}
        <span
          className={`inline-block h-1.5 w-10 rounded-full ${colors.tag
            .split(" ")
            .filter((c) => c.startsWith("bg-"))
            .join(" ")}`}
          aria-hidden
        />

        <p className="font-medium text-foreground text-sm leading-snug">{item.title}</p>

        {item.entityName ? (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Building2 className="size-3" />
            <span className="truncate">{item.entityName}</span>
          </div>
        ) : null}

        <div className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
          {item.valueAmount ? (
            <span className={`rounded px-1.5 py-0.5 font-medium ${colors.amount}`}>
              {formatEuro(Number(item.valueAmount))}
            </span>
          ) : null}
          {item.probability != null ? (
            <span
              className="inline-flex items-center gap-1"
              title={`Probabilité ${item.probability}%`}
            >
              <span className="relative inline-block h-1 w-6 overflow-hidden rounded-full bg-muted">
                <span
                  className="absolute inset-y-0 left-0 bg-foreground/70"
                  style={{ width: `${Math.max(0, Math.min(100, item.probability))}%` }}
                />
              </span>
              <span className="tabular-nums">{item.probability}%</span>
            </span>
          ) : null}
          {item.followUpDate
            ? (() => {
                const followUp = new Date(item.followUpDate);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const followUpDay = new Date(
                  followUp.getFullYear(),
                  followUp.getMonth(),
                  followUp.getDate(),
                );
                const overdueDays = Math.floor(
                  (today.getTime() - followUpDay.getTime()) / 86400000,
                );
                if (overdueDays > 0) {
                  return (
                    <span className="inline-flex items-center gap-0.5 font-medium text-destructive">
                      <Clock className="size-3" />
                      En retard de {overdueDays}j
                    </span>
                  );
                }
                return (
                  <span className="inline-flex items-center gap-0.5">
                    <Clock className="size-3" />
                    {formatDate(item.followUpDate)}
                  </span>
                );
              })()
            : null}
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
