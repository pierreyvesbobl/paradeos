"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { createTimeEntry, deleteTimeEntry, updateTimeEntry } from "@/lib/actions/time-entries";
import {
  type TimeEntryKind,
  timeEntryKindEnum,
  timeEntryKindLabels,
} from "@/lib/schemas/time-entries";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

const NONE = "__none__";

type Defaults = {
  id?: string;
  kind: TimeEntryKind;
  startAt: string;
  endAt: string;
  title: string;
  description: string;
  taskId: string;
  projectId: string;
  contactId: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  defaults: Defaults;
  tasks: { id: string; title: string }[];
  projects: { id: string; name: string }[];
  contacts: { id: string; label: string }[];
};

export function TimeEntryDialog({
  open,
  onClose,
  mode,
  defaults,
  tasks,
  projects,
  contacts,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  const [kind, setKind] = useState<TimeEntryKind>(defaults.kind);
  const [startAt, setStartAt] = useState(defaults.startAt);
  const [endAt, setEndAt] = useState(defaults.endAt);
  const [title, setTitle] = useState(defaults.title);
  const [description, setDescription] = useState(defaults.description);
  const [taskId, setTaskId] = useState(defaults.taskId || NONE);
  const [projectId, setProjectId] = useState(defaults.projectId || NONE);
  const [contactId, setContactId] = useState(defaults.contactId || NONE);

  function buildPayload() {
    return {
      kind,
      startAt: toIso(startAt),
      endAt: toIso(endAt),
      title: title || undefined,
      description: description || undefined,
      taskId: taskId === NONE ? undefined : taskId,
      projectId: projectId === NONE ? undefined : projectId,
      contactId: contactId === NONE ? undefined : contactId,
    };
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const payload = buildPayload();
      const result =
        mode === "create"
          ? await createTimeEntry(payload)
          : await updateTimeEntry({ ...payload, id: defaults.id ?? "" });

      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        toast.error(result.message);
        return;
      }
      toast.success(mode === "create" ? "Créneau créé." : "Créneau mis à jour.");
      onClose();
      router.refresh();
    });
  }

  function onDelete() {
    if (mode !== "edit" || !defaults.id) return;
    if (!confirm("Supprimer ce créneau ?")) return;
    startTransition(async () => {
      const result = await deleteTimeEntry({ id: defaults.id ?? "" });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Créneau supprimé.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Nouveau créneau" : "Modifier le créneau"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="kind">Type</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as TimeEntryKind)}
              disabled={pending}
            >
              <SelectTrigger id="kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timeEntryKindEnum.options.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {timeEntryKindLabels[opt]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="startAt">Début</Label>
              <Input
                id="startAt"
                type="datetime-local"
                required
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endAt">Fin</Label>
              <Input
                id="endAt"
                type="datetime-local"
                required
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                disabled={pending}
              />
              {errors.endAt ? <p className="text-destructive text-xs">{errors.endAt[0]}</p> : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Titre</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Réunion, deep work, prospection…"
              disabled={pending}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="taskId">Tâche</Label>
              <Select value={taskId} onValueChange={setTaskId} disabled={pending}>
                <SelectTrigger id="taskId">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {tasks.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              <Label htmlFor="contactId">Contact</Label>
              <Select value={contactId} onValueChange={setContactId} disabled={pending}>
                <SelectTrigger id="contactId">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Notes</Label>
            <Textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={pending}
            />
          </div>

          <DialogFooter className="!justify-between">
            {mode === "edit" ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={onDelete}
                disabled={pending}
              >
                Supprimer
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                Annuler
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Enregistrement…" : mode === "create" ? "Créer" : "Enregistrer"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function toIso(localValue: string): string {
  // <input type="datetime-local"> renvoie "YYYY-MM-DDTHH:mm" sans timezone.
  // On l'interprète comme heure locale.
  const d = new Date(localValue);
  return d.toISOString();
}
