"use client";

import { Button } from "@/components/ui/button";
import { createTask } from "@/lib/actions/tasks";
import { addDays, isoDate } from "@/lib/calendar";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Ligne de quick-add sous la grille Gantt. Crée une tâche avec
 * `start_date = aujourd'hui` et `due_date = aujourd'hui + 6 jours`
 * (1 semaine, taille raisonnable pour la grabber et la resize ensuite
 * via drag). Le projet courant (filtre) est appliqué.
 */
export function GanttQuickAdd({ projectId }: { projectId: string | null }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    const today = new Date();
    const start = isoDate(today);
    const due = isoDate(addDays(today, 6));

    startTransition(async () => {
      const res = await createTask({
        title: trimmed,
        status: "todo",
        priority: "medium",
        projectId: projectId ?? undefined,
        startDate: start,
        dueDate: due,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`« ${trimmed} » créée.`);
      setTitle("");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/20 p-2"
    >
      <Plus className="ml-1 size-4 shrink-0 text-muted-foreground" />
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Nouvelle tâche — apparaît dans le Gantt à partir d'aujourd'hui (1 semaine)"
        disabled={pending}
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
      />
      <Button type="submit" size="sm" disabled={pending || !title.trim()}>
        {pending ? "…" : "Ajouter"}
      </Button>
    </form>
  );
}
