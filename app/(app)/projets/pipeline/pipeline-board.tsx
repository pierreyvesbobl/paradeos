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
import { patchProject } from "@/lib/actions/projects";
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
import { Building2, Clock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

export type PipelineItem = {
  id: string;
  name: string;
  status: ProjectStatus;
  valueAmount: string | null;
  probability: number | null;
  followUpDate: string | null;
  entityName: string | null;
};

const COLUMNS: ProjectStatus[] = [
  "not_started",
  "to_follow_up",
  "awaiting_response",
  "won",
  "lost",
];

const STATUS_DOT: Record<ProjectStatus, string> = {
  not_started: "bg-slate-400",
  to_follow_up: "bg-amber-500",
  awaiting_response: "bg-orange-500",
  won: "bg-emerald-500",
  lost: "bg-rose-500",
  planning: "bg-slate-400",
  active: "bg-emerald-500",
  on_hold: "bg-slate-300",
  completed: "bg-indigo-500",
  archived: "bg-slate-300",
};

export function PipelineBoard({ items }: { items: PipelineItem[] }) {
  const router = useRouter();
  const [optimisticItems, applyMove] = useOptimistic<
    PipelineItem[],
    { id: string; status: ProjectStatus }
  >(items, (state, payload) =>
    state.map((it) => (it.id === payload.id ? { ...it, status: payload.status } : it)),
  );
  const [, startTransition] = useTransition();
  // Quand un drop atteint "won" sur un projet en phase commerciale, on
  // propose tout de suite de basculer en delivery.
  const [deliveryCandidate, setDeliveryCandidate] = useState<PipelineItem | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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
      // Drop sur "won" et phase commerciale → propose la delivery.
      if (nextStatus === "won" && current.status !== "won") {
        queueMicrotask(() => setDeliveryCandidate({ ...current, status: "won" }));
      }
    });
  }

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="-mx-6 overflow-x-auto px-6 pb-2">
          <div className="flex items-start gap-3">
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

  function Column({ status, items }: { status: ProjectStatus; items: PipelineItem[] }) {
    const { setNodeRef, isOver } = useDroppable({ id: status });
    const total = items.reduce((acc, it) => acc + Number(it.valueAmount ?? 0), 0);
    return (
      <section
        ref={setNodeRef}
        className={`flex w-72 shrink-0 flex-col gap-2 rounded-lg border p-2 transition-colors ${
          isOver ? "border-foreground/30 bg-muted/70" : "bg-muted/40"
        }`}
      >
        <header className="flex items-center justify-between px-2 py-1">
          <div className="flex items-center gap-2">
            <span className={`inline-block size-2 rounded-full ${STATUS_DOT[status]}`} />
            <h2 className="font-medium text-sm">{projectStatusLabels[status]}</h2>
            <span className="text-muted-foreground text-xs">{items.length}</span>
          </div>
          {total > 0 ? (
            <span className="font-medium text-muted-foreground text-xs tabular-nums">
              {formatEuro(total)}
            </span>
          ) : null}
        </header>
        <ul className="flex flex-col gap-2">
          {items.map((it) => (
            <Card key={it.id} item={it} />
          ))}
        </ul>
      </section>
    );
  }
}

function Card({ item }: { item: PipelineItem }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
  });
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 50,
      }
    : undefined;

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`group cursor-grab rounded-lg border border-border/60 bg-background shadow-sm transition-shadow active:cursor-grabbing ${
        isDragging ? "opacity-70 shadow-lg ring-2 ring-foreground/20" : "hover:shadow-md"
      }`}
    >
      <Link
        href={`/projets/${item.id}`}
        onClick={(e) => {
          if (isDragging) e.preventDefault();
        }}
        className="block space-y-2 px-3 py-2.5"
      >
        <p className="font-medium text-foreground text-sm leading-snug">{item.name}</p>
        {item.entityName ? (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Building2 className="size-3" />
            <span className="truncate">{item.entityName}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
          {item.valueAmount ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
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
                  style={{
                    width: `${Math.max(0, Math.min(100, item.probability))}%`,
                  }}
                />
              </span>
              <span className="tabular-nums">{item.probability}%</span>
            </span>
          ) : null}
          {item.followUpDate ? <FollowUpBadge date={item.followUpDate} /> : null}
        </div>
      </Link>
    </li>
  );
}

function FollowUpBadge({ date }: { date: string }) {
  const followUp = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const followUpDay = new Date(followUp.getFullYear(), followUp.getMonth(), followUp.getDate());
  const overdueDays = Math.floor((today.getTime() - followUpDay.getTime()) / 86400000);
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
      {formatDate(date)}
    </span>
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
