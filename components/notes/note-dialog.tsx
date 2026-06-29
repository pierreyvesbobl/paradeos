"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { createNote, deleteNote, updateNote } from "@/lib/actions/notes";
import { scrollToFirstError } from "@/lib/forms/scroll-to-error";
import {
  type NoteKind,
  type NoteSubjectType,
  noteKindEnum,
  noteKindLabels,
} from "@/lib/schemas/notes";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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

type Draft = {
  title: string;
  content: string;
  kind: NoteKind;
  occurredAt: string;
};

const DEFAULTS_BLANK: Defaults = {
  title: "",
  content: "",
  kind: "memo",
  occurredAt: localInput(new Date()),
};

const DRAFT_PREFIX = "paradeos:note-draft:";
const DRAFT_DEBOUNCE_MS = 400;

function readDraftFromStorage(key: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (typeof parsed.content !== "string") return null;
    const kindOk = (noteKindEnum.options as readonly string[]).includes(
      (parsed.kind as string) ?? "",
    );
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      content: parsed.content,
      kind: kindOk ? (parsed.kind as NoteKind) : "memo",
      occurredAt:
        typeof parsed.occurredAt === "string" && parsed.occurredAt.length > 0
          ? parsed.occurredAt
          : localInput(new Date()),
    };
  } catch {
    return null;
  }
}

function writeDraftToStorage(key: string, d: Draft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(d));
  } catch {
    // ignore (mode privé, quota plein, etc.)
  }
}

function clearDraftFromStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function NoteDialog({ subjectType, subjectId, initial, trigger }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isEdit = Boolean(initial?.id);
  const seed = useMemo(() => initial ?? DEFAULTS_BLANK, [initial]);

  // Clé stable pour le brouillon local : un brouillon par sujet (création) ou
  // par note (édition). Permet de reprendre exactement là où on s'était arrêté.
  const draftKey = useMemo(() => {
    if (isEdit) return `${DRAFT_PREFIX}edit:${initial?.id ?? ""}`;
    if (subjectType && subjectId) return `${DRAFT_PREFIX}new:${subjectType}:${subjectId}`;
    return `${DRAFT_PREFIX}new:free`;
  }, [isEdit, initial?.id, subjectType, subjectId]);

  const [title, setTitle] = useState(seed.title);
  const [content, setContent] = useState(seed.content);
  const [kind, setKind] = useState<NoteKind>(seed.kind);
  const [occurredAt, setOccurredAt] = useState(seed.occurredAt);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [restored, setRestored] = useState(false);

  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function reset() {
    setTitle(seed.title);
    setContent(seed.content);
    setKind(seed.kind);
    setOccurredAt(seed.occurredAt);
    setErrors({});
    setRestored(false);
  }

  // Restaure un éventuel brouillon à l'ouverture.
  useEffect(() => {
    if (!open) return;
    const draft = readDraftFromStorage(draftKey);
    if (!draft) return;
    const sameAsSeed =
      draft.title === seed.title &&
      draft.content === seed.content &&
      draft.kind === seed.kind &&
      draft.occurredAt === seed.occurredAt;
    if (sameAsSeed) return;
    setTitle(draft.title);
    setContent(draft.content);
    setKind(draft.kind);
    setOccurredAt(draft.occurredAt);
    setRestored(true);
  }, [open, draftKey, seed]);

  // Persistance auto du brouillon dès qu'on diverge du seed.
  useEffect(() => {
    if (!open) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const isDirty =
      title !== seed.title ||
      content !== seed.content ||
      kind !== seed.kind ||
      occurredAt !== seed.occurredAt;
    draftTimer.current = setTimeout(() => {
      if (isDirty) writeDraftToStorage(draftKey, { title, content, kind, occurredAt });
      else clearDraftFromStorage(draftKey);
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [open, title, content, kind, occurredAt, draftKey, seed]);

  // Garde-fou : alerte navigateur avant fermeture/refresh si du contenu n'est
  // pas sauvegardé. Le brouillon local couvre déjà le cas, c'est une 2e ligne.
  useEffect(() => {
    if (!open) return;
    const isDirty =
      title !== seed.title ||
      content !== seed.content ||
      kind !== seed.kind ||
      occurredAt !== seed.occurredAt;
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [open, title, content, kind, occurredAt, seed]);

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
        scrollToFirstError(result.fieldErrors);
        toast.error(result.message);
        return;
      }
      clearDraftFromStorage(draftKey);
      toast.success(isEdit ? "Note mise à jour." : "Note ajoutée.");
      setOpen(false);
      if (!isEdit) reset();
      router.refresh();
    });
  }

  function onDelete() {
    if (!isEdit || !initial?.id) return;
    setConfirmDelete(true);
  }

  function confirmDeleteNote() {
    if (!isEdit || !initial?.id) return;
    startTransition(async () => {
      const result = await deleteNote({ id: initial.id ?? "" });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      clearDraftFromStorage(draftKey);
      toast.success("Note supprimée.");
      setConfirmDelete(false);
      setOpen(false);
      router.refresh();
    });
  }

  function discardDraft() {
    clearDraftFromStorage(draftKey);
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // À la fermeture, on remet les inputs au seed pour ne pas afficher
        // les anciennes valeurs si on rouvre. Le brouillon reste en
        // localStorage et sera restauré au prochain open.
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifier la note" : "Nouvelle note"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          {restored ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-xs dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
              <span>Brouillon récupéré depuis ce navigateur.</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900"
                onClick={discardDraft}
                disabled={pending}
              >
                Repartir de zéro
              </Button>
            </div>
          ) : null}

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
            <FieldError messages={errors.content} />
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
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Supprimer cette note ?"
        description="Cette action est irréversible."
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={confirmDeleteNote}
        pending={pending}
      />
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
