"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { Button } from "@/components/ui/button";
import { DateRangePicker, formatIsoDate, parseIsoDate } from "@/components/ui/date-range-picker";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createTask, updateTask } from "@/lib/actions/tasks";
import { scrollToFirstError } from "@/lib/forms/scroll-to-error";
import {
  type TaskPriority,
  type TaskStatus,
  taskPriorityEnum,
  taskPriorityLabels,
  taskStatusEnum,
  taskStatusLabels,
} from "@/lib/schemas/tasks";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type ProjectOption = { id: string; name: string };
type UserOption = { id: string; fullName: string | null };

type Props = {
  mode: "create" | "edit";
  projects: ProjectOption[];
  users: UserOption[];
  defaultValues: {
    id?: string;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    projectId: string;
    assigneeId: string;
    dueDate: string;
    startDate: string;
  };
};

export function TaskForm({ mode, projects, users, defaultValues }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  const [title, setTitle] = useState(defaultValues.title);
  const [description, setDescription] = useState(defaultValues.description);
  const [status, setStatus] = useState<TaskStatus>(defaultValues.status);
  const [priority, setPriority] = useState<TaskPriority>(defaultValues.priority);
  const [projectId, setProjectId] = useState<string | null>(defaultValues.projectId || null);
  const [assigneeId, setAssigneeId] = useState<string | null>(defaultValues.assigneeId || null);
  const [dueDate, setDueDate] = useState(defaultValues.dueDate);
  const [startDate, setStartDate] = useState(defaultValues.startDate);

  function buildPayload() {
    return {
      title,
      description: description || undefined,
      status,
      priority,
      projectId: projectId ?? undefined,
      assigneeId: assigneeId ?? undefined,
      dueDate: dueDate || undefined,
      startDate: startDate || undefined,
    };
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const payload = buildPayload();
      const result =
        mode === "create"
          ? await createTask(payload)
          : await updateTask({ ...payload, id: defaultValues.id ?? "" });

      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        scrollToFirstError(result.fieldErrors);
        toast.error(result.message);
        return;
      }
      toast.success(mode === "create" ? "Tâche créée." : "Tâche mise à jour.");
      const id = mode === "create" ? result.data.id : defaultValues.id;
      router.push(`/taches/${id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-10">
      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Tâche
        </h2>
        <div className="space-y-2">
          <Label htmlFor="title">Titre *</Label>
          <Input
            id="title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={pending}
          />
          <FieldError messages={errors.title} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={pending}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          État
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="status">Statut</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as TaskStatus)}
              disabled={pending}
            >
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {taskStatusEnum.options.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {taskStatusLabels[opt]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="priority">Priorité</Label>
            <Select
              value={priority}
              onValueChange={(v) => setPriority(v as TaskPriority)}
              disabled={pending}
            >
              <SelectTrigger id="priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {taskPriorityEnum.options.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {taskPriorityLabels[opt]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Lien & assignation
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="projectId">Projet</Label>
            <FkCombobox
              id="projectId"
              value={projectId}
              onValueChange={setProjectId}
              options={projects.map((p) => ({ id: p.id, label: p.name }))}
              searchPlaceholder="Rechercher un projet…"
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="assigneeId">Assignée à</Label>
            <FkCombobox
              id="assigneeId"
              value={assigneeId}
              onValueChange={setAssigneeId}
              options={users.map((u) => ({ id: u.id, label: u.fullName ?? "(sans nom)" }))}
              searchPlaceholder="Rechercher un membre…"
              disabled={pending}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Période (début & échéance)</Label>
            <DateRangePicker
              value={
                startDate || dueDate
                  ? { start: parseIsoDate(startDate), end: parseIsoDate(dueDate) }
                  : null
              }
              onChange={(r) => {
                setStartDate(r?.start ? formatIsoDate(r.start) : "");
                setDueDate(r?.end ? formatIsoDate(r.end) : "");
              }}
              disabled={pending}
              placeholder="Définir la période"
              triggerVariant="outline"
              triggerSize="default"
              className="w-full"
            />
            <p className="text-muted-foreground text-xs">
              Glisse pour sélectionner l'intervalle d'un coup, ou clique sur un preset à gauche.
            </p>
          </div>
        </div>
      </section>

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background/90 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending || !title.trim()}>
          {pending ? "Enregistrement…" : mode === "create" ? "Créer" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
