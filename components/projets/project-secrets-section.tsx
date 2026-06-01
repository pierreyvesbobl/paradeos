"use client";

import { EmptyState } from "@/components/empty-state";
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
import { Textarea } from "@/components/ui/textarea";
import {
  createProjectSecret,
  deleteProjectSecret,
  revealProjectSecret,
  updateProjectSecret,
} from "@/lib/actions/project-secrets";
import type { ProjectSecretListItem } from "@/lib/db/queries/project-secrets";
import { cn } from "@/lib/utils";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  User,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

const REVEAL_AUTO_HIDE_MS = 30_000;

type Props = {
  projectId: string;
  secrets: ProjectSecretListItem[];
};

export function ProjectSecretsSection({ projectId, secrets }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectSecretListItem | null>(null);
  const [confirm, setConfirm] = useState<ProjectSecretListItem | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(s: ProjectSecretListItem) {
    setEditing(s);
    setDialogOpen(true);
  }

  function onConfirmDelete() {
    if (!confirm) return;
    startTransition(async () => {
      const result = await deleteProjectSecret({ id: confirm.id });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Secret supprimé.");
      setConfirm(null);
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-sm">Secrets ({secrets.length})</h2>
        <Button size="sm" onClick={openCreate}>
          <Plus className="-ms-1 me-1" size={14} aria-hidden="true" />
          Ajouter un secret
        </Button>
      </div>

      {secrets.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="Aucun secret enregistré."
          description="Stocke ici les mdp, clés API et tokens liés au projet. Tout est chiffré côté serveur."
        />
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {secrets.map((s) => (
            <SecretRow
              key={s.id}
              secret={s}
              onEdit={() => openEdit(s)}
              onDelete={() => setConfirm(s)}
            />
          ))}
        </ul>
      )}

      <SecretDialog
        key={editing?.id ?? "new"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={projectId}
        initial={editing}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={`Supprimer "${confirm?.label}" ?`}
        description="Le secret sera définitivement effacé."
        confirmLabel="Supprimer"
        variant="destructive"
        pending={pending}
        onConfirm={onConfirmDelete}
      />
    </section>
  );
}

function SecretRow({
  secret,
  onEdit,
  onDelete,
}: {
  secret: ProjectSecretListItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [revealed, setRevealed] = useState<{
    value: string;
    username: string | null;
    notes: string | null;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  function scheduleHide() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setRevealed(null), REVEAL_AUTO_HIDE_MS);
  }

  function onToggleReveal() {
    if (revealed) {
      setRevealed(null);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      return;
    }
    startTransition(async () => {
      const result = await revealProjectSecret({ id: secret.id });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setRevealed(result.data);
      scheduleHide();
    });
  }

  function onCopy() {
    startTransition(async () => {
      const result = await revealProjectSecret({ id: secret.id });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      try {
        await navigator.clipboard.writeText(result.data.value);
        toast.success("Valeur copiée.");
      } catch {
        toast.error("Impossible d'accéder au presse-papier.");
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 hover:bg-muted/40">
      <div className="flex items-center gap-3">
        <KeyRound className="shrink-0 text-muted-foreground" size={14} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-sm">{secret.label}</span>
            {secret.hasUsername ? (
              <User className="text-muted-foreground" size={12} aria-label="Username défini" />
            ) : null}
            {secret.hasNotes ? (
              <StickyNote className="text-muted-foreground" size={12} aria-label="Notes définies" />
            ) : null}
          </div>
          {secret.url ? (
            <a
              href={secret.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:underline"
            >
              <span className="truncate">{secret.url}</span>
              <ExternalLink className="shrink-0" size={10} aria-hidden="true" />
            </a>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onToggleReveal}
            disabled={pending}
            aria-label={revealed ? "Masquer" : "Révéler"}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onCopy}
            disabled={pending}
            aria-label="Copier la valeur"
          >
            <Copy size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onEdit}
            aria-label="Modifier"
          >
            <Pencil size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive hover:text-destructive"
            onClick={onDelete}
            aria-label="Supprimer"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      {revealed ? (
        <RevealedPanel
          data={revealed}
          hasUsername={secret.hasUsername}
          hasNotes={secret.hasNotes}
        />
      ) : null}
    </li>
  );
}

function RevealedPanel({
  data,
  hasUsername,
  hasNotes,
}: {
  data: { value: string; username: string | null; notes: string | null };
  hasUsername: boolean;
  hasNotes: boolean;
}) {
  return (
    <div className="space-y-2 rounded-md border border-dashed bg-muted/30 p-2.5 text-xs">
      {hasUsername && data.username !== null ? (
        <RevealedField label="Username" value={data.username} mono />
      ) : null}
      <RevealedField label="Valeur" value={data.value} mono />
      {hasNotes && data.notes !== null ? (
        <RevealedField label="Notes" value={data.notes} preserveWhitespace />
      ) : null}
      <p className="text-[10px] text-muted-foreground">Auto-masquage dans 30 s.</p>
    </div>
  );
}

function RevealedField({
  label,
  value,
  mono,
  preserveWhitespace,
}: {
  label: string;
  value: string;
  mono?: boolean;
  preserveWhitespace?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Impossible d'accéder au presse-papier.");
    }
  }
  return (
    <div className="flex items-start gap-2">
      <span className="w-16 shrink-0 text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 break-all",
          mono && "font-mono",
          preserveWhitespace && "whitespace-pre-wrap",
        )}
      >
        {value}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-5 shrink-0"
        onClick={onCopy}
        aria-label={`Copier ${label}`}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </Button>
    </div>
  );
}

type DialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  initial: ProjectSecretListItem | null;
};

function SecretDialog({ open, onOpenChange, projectId, initial }: DialogProps) {
  const router = useRouter();
  const isEdit = initial !== null;
  const [label, setLabel] = useState(initial?.label ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [username, setUsername] = useState("");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, startTransition] = useTransition();

  function reset() {
    setLabel(initial?.label ?? "");
    setUrl(initial?.url ?? "");
    setUsername("");
    setValue("");
    setNotes("");
    setShowValue(false);
    setErrors({});
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = isEdit
        ? await updateProjectSecret({
            id: initial.id,
            label,
            url: url || undefined,
            // undefined = inchangé ; "" reste possible via le clic explicite "effacer" si on ajoute un bouton plus tard.
            username: username.length > 0 ? username : undefined,
            value: value.length > 0 ? value : undefined,
            notes: notes.length > 0 ? notes : undefined,
          })
        : await createProjectSecret({
            projectId,
            label,
            url: url || undefined,
            username: username || undefined,
            value,
            notes: notes || undefined,
          });

      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        toast.error(result.message);
        return;
      }
      toast.success(isEdit ? "Secret mis à jour." : "Secret ajouté.");
      onOpenChange(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifier le secret" : "Nouveau secret"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="secret-label">Label *</Label>
            <Input
              id="secret-label"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="OpenAI API key, Wifi bureau client…"
              disabled={pending}
              autoFocus
            />
            <FieldError messages={errors.label} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="secret-url">URL (optionnel)</Label>
            <Input
              id="secret-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://platform.openai.com"
              disabled={pending}
            />
            <FieldError messages={errors.url} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="secret-username">Username (optionnel)</Label>
            <Input
              id="secret-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={isEdit ? "Laisser vide pour conserver" : "pierre@paradeos.fr"}
              disabled={pending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="secret-value">Valeur {isEdit ? "" : "*"}</Label>
            <div className="relative">
              <Input
                id="secret-value"
                type={showValue ? "text" : "password"}
                required={!isEdit}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={isEdit ? "Laisser vide pour conserver" : "sk-…"}
                disabled={pending}
                className="pe-9 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowValue((v) => !v)}
                className="-translate-y-1/2 absolute end-2 top-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showValue ? "Masquer" : "Afficher"}
                tabIndex={-1}
              >
                {showValue ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <FieldError messages={errors.value} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="secret-notes">Notes (optionnel)</Label>
            <Textarea
              id="secret-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={isEdit ? "Laisser vide pour conserver" : "Codes MFA backup, contexte…"}
              disabled={pending}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={pending || !label.trim() || (!isEdit && !value)}>
              {pending ? "Enregistrement…" : isEdit ? "Enregistrer" : "Ajouter"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
