"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { createNote, deleteNote, updateNote } from "@/lib/actions/notes";
import {
  type NoteKind,
  type NoteSubjectType,
  noteKindEnum,
  noteKindLabels,
} from "@/lib/schemas/notes";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Defaults = {
  id?: string;
  title: string;
  content: string;
  kind: NoteKind;
  occurredAt: string; // ISO local datetime
};

type Props = {
  /** Sujet auquel rattacher la note (omis = note libre). */
  subjectType?: NoteSubjectType;
  subjectId?: string;
  /** Mode édition si fourni. Si omis, dialog en mode création. */
  initial?: Defaults;
  trigger: React.ReactNode;
};

const DEFAULTS_BLANK: Defaults = {
  title: "",
  content: "",
  kind: "memo",
  occurredAt: localInput(new Date()),
};

export function NoteDialog({ subjectType, subjectId, initial, trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isEdit = Boolean(initial?.id);
  const seed = initial ?? DEFAULTS_BLANK;

  const [title, setTitle] = useState(seed.title);
  const [content, setContent] = useState(seed.content);
  const [kind, setKind] = useState<NoteKind>(seed.kind);
  const [occurredAt, setOccurredAt] = useState(seed.occurredAt);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  function reset() {
    setTitle(seed.title);
    setContent(seed.content);
    setKind(seed.kind);
    setOccurredAt(seed.occurredAt);
    setErrors({});
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const payload = {
        title: title || undefined,
        content,
        kind,
        subjectType,
        subjectId,
        occurredAt: new Date(occurredAt).toISOString(),
      };
      const result = isEdit
        ? await updateNote({ ...payload, id: initial?.id ?? "" })
        : await createNote(payload);

      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        toast.error(result.message);
        return;
      }
      toast.success(isEdit ? "Note mise à jour." : "Note ajoutée.");
      setOpen(false);
      if (!isEdit) reset();
      router.refresh();
    });
  }

  function onDelete() {
    if (!isEdit || !initial?.id) return;
    if (!confirm("Supprimer cette note ?")) return;
    startTransition(async () => {
      const result = await deleteNote({ id: initial.id ?? "" });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Note supprimée.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifier la note" : "Nouvelle note"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="note-kind">Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as NoteKind)} disabled={pending}>
                <SelectTrigger id="note-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {noteKindEnum.options.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {noteKindLabels[opt]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="note-occurred">Date</Label>
              <Input
                id="note-occurred"
                type="datetime-local"
                required
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note-title">Titre (optionnel)</Label>
            <Input
              id="note-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Réunion kick-off, appel découverte…"
              disabled={pending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note-content">Contenu *</Label>
            <Textarea
              id="note-content"
              required
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={pending}
            />
            {errors.content ? (
              <p className="text-destructive text-xs">{errors.content[0]}</p>
            ) : null}
          </div>

          <DialogFooter className="!justify-between">
            {isEdit ? (
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
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={pending || !content.trim()}>
                {pending ? "Enregistrement…" : isEdit ? "Enregistrer" : "Ajouter"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function localInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}
