"use client";

import { Button } from "@/components/ui/button";
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
  };
};

const NONE = "__none__";

export function TaskForm({ mode, projects, users, defaultValues }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  const [title, setTitle] = useState(defaultValues.title);
  const [description, setDescription] = useState(defaultValues.description);
  const [status, setStatus] = useState<TaskStatus>(defaultValues.status);
  const [priority, setPriority] = useState<TaskPriority>(defaultValues.priority);
  const [projectId, setProjectId] = useState(defaultValues.projectId || NONE);
  const [assigneeId, setAssigneeId] = useState(defaultValues.assigneeId || NONE);
  const [dueDate, setDueDate] = useState(defaultValues.dueDate);

  function buildPayload() {
    return {
      title,
      description: description || undefined,
      status,
      priority,
      projectId: projectId === NONE ? undefined : projectId,
      assigneeId: assigneeId === NONE ? undefined : assigneeId,
      dueDate: dueDate || undefined,
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
    <form onSubmit={onSubmit} className="space-y-8">
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Tâche</h2>
        <div className="space-y-2">
          <Label htmlFor="title">Titre *</Label>
          <Input
            id="title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={pending}
          />
          {errors.title ? <p className="text-destructive text-xs">{errors.title[0]}</p> : null}
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

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">État</h2>
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

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Lien & assignation</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="projectId">Projet</Label>
            <Select value={projectId} onValueChange={setProjectId} disabled={pending}>
              <SelectTrigger id="projectId">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="assigneeId">Assignée à</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId} disabled={pending}>
              <SelectTrigger id="assigneeId">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.fullName ?? "(sans nom)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="dueDate">Échéance</Label>
            <Input
              id="dueDate"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={pending}
            />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
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
