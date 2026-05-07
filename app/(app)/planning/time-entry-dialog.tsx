"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { createTimeEntry, deleteTimeEntry, updateTimeEntry } from "@/lib/actions/time-entries";
import { scrollToFirstError } from "@/lib/forms/scroll-to-error";
import {
  type TimeEntryKind,
  timeEntryKindEnum,
  timeEntryKindLabels,
} from "@/lib/schemas/time-entries";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

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
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [kind, setKind] = useState<TimeEntryKind>(defaults.kind);
  const [startAt, setStartAt] = useState(defaults.startAt);
  const [endAt, setEndAt] = useState(defaults.endAt);
  const [title, setTitle] = useState(defaults.title);
  const [description, setDescription] = useState(defaults.description);
  const [taskId, setTaskId] = useState<string | null>(defaults.taskId || null);
  const [projectId, setProjectId] = useState<string | null>(defaults.projectId || null);
  const [contactId, setContactId] = useState<string | null>(defaults.contactId || null);

  function buildPayload() {
    return {
      kind,
      startAt: toIso(startAt),
      endAt: toIso(endAt),
      title: title || undefined,
      description: description || undefined,
      taskId: taskId ?? undefined,
      projectId: projectId ?? undefined,
      contactId: contactId ?? undefined,
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
        scrollToFirstError(result.fieldErrors);
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
    setConfirmDelete(true);
  }

  function confirmDeleteEntry() {
    if (mode !== "edit" || !defaults.id) return;
    startTransition(async () => {
      const result = await deleteTimeEntry({ id: defaults.id ?? "" });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Créneau supprimé.");
      setConfirmDelete(false);
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
              <FieldError messages={errors.endAt} />
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="taskId">Tâche</Label>
              <FkCombobox
                id="taskId"
                value={taskId}
                onValueChange={setTaskId}
                options={tasks.map((t) => ({ id: t.id, label: t.title }))}
                searchPlaceholder="Rechercher une tâche…"
                disabled={pending}
              />
            </div>
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
              <Label htmlFor="contactId">Contact</Label>
              <FkCombobox
                id="contactId"
                value={contactId}
                onValueChange={setContactId}
                options={contacts.map((c) => ({ id: c.id, label: c.label }))}
                searchPlaceholder="Rechercher un contact…"
                disabled={pending}
              />
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
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Supprimer ce créneau ?"
        description="Cette action est irréversible."
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={confirmDeleteEntry}
        pending={pending}
      />
    </Dialog>
  );
}

function toIso(localValue: string): string {
  // <input type="datetime-local"> renvoie "YYYY-MM-DDTHH:mm" sans timezone.
  // On l'interprète comme heure locale.
  const d = new Date(localValue);
  return d.toISOString();
}
