"use client";

import { ArrowCounterClockwise, FloppyDisk, Play, Power } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  processPendingCandidatureReplies,
  retryCandidatureReply,
  setCandidatureAutoReplyEnabled,
  setCandidatureReplyTemplate,
} from "@/lib/actions/candidatures";

type RecentReply = {
  id: string;
  status: "pending" | "replied" | "rejected" | "error";
  candidate: string;
  subject: string;
  detail: string;
  receivedAt: string | null;
  repliedAt: string | null;
};

type Props = {
  enabled: boolean;
  /** Valeurs en base (vide = défaut). */
  from: string;
  body: string;
  defaultFrom: string;
  defaultBody: string;
  recent: RecentReply[];
};

const STATUS_LABEL: Record<RecentReply["status"], string> = {
  pending: "En attente",
  replied: "Répondue",
  rejected: "Écartée",
  error: "Erreur",
};

const STATUS_TINT: Record<RecentReply["status"], string> = {
  pending: "text-amber-700 dark:text-amber-400",
  replied: "text-emerald-700 dark:text-emerald-400",
  rejected: "text-muted-foreground",
  error: "text-rose-700 dark:text-rose-400",
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

export function CandidaturesSettings({
  enabled,
  from,
  body,
  defaultFrom,
  defaultBody,
  recent,
}: Props) {
  const router = useRouter();
  const [fromInput, setFromInput] = useState(from || defaultFrom);
  const [bodyInput, setBodyInput] = useState(body || defaultBody);
  const [pending, startTransition] = useTransition();

  function toggleEnabled() {
    startTransition(async () => {
      const res = await setCandidatureAutoReplyEnabled({ enabled: !enabled });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(enabled ? "Agent désactivé." : "Agent activé.");
      router.refresh();
    });
  }

  function saveTemplate() {
    startTransition(async () => {
      const res = await setCandidatureReplyTemplate({
        from: fromInput === defaultFrom ? "" : fromInput,
        body: bodyInput === defaultBody ? "" : bodyInput,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Réponse enregistrée.");
      router.refresh();
    });
  }

  function drainPending() {
    startTransition(async () => {
      const res = await processPendingCandidatureReplies({});
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(
        `Répondues : ${res.data.replied} · Écartées : ${res.data.rejected} · Erreurs : ${res.data.errored}`,
      );
      router.refresh();
    });
  }

  function retry(id: string) {
    startTransition(async () => {
      const res = await retryCandidatureReply({ replyId: id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Remise en file.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="candidature-from" className="font-medium text-[11px]">
          Expéditeur de la réponse
        </label>
        <Input
          id="candidature-from"
          value={fromInput}
          onChange={(e) => setFromInput(e.target.value)}
          placeholder={defaultFrom}
          disabled={pending}
          className="h-8 text-xs"
        />
        <p className="text-[10px] text-muted-foreground">
          Doit être une adresse « envoyer en tant que » du compte Gmail connecté.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="candidature-body" className="font-medium text-[11px]">
          Texte de la réponse
        </label>
        <Textarea
          id="candidature-body"
          value={bodyInput}
          onChange={(e) => setBodyInput(e.target.value)}
          disabled={pending}
          rows={10}
          className="text-xs"
        />
        <p className="text-[10px] text-muted-foreground">
          <code>{"{prenom}"}</code> est remplacé par le prénom du candidat quand on le connaît.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={saveTemplate}
          disabled={pending || !bodyInput.trim()}
          className="gap-1.5"
        >
          <FloppyDisk className="size-3.5" />
          Enregistrer
        </Button>
        <Button
          type="button"
          size="sm"
          variant={enabled ? "default" : "outline"}
          onClick={toggleEnabled}
          disabled={pending}
          className="gap-1.5"
        >
          <Power className="size-3.5" />
          {enabled ? "Activé" : "Désactivé"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={drainPending}
          disabled={pending || !enabled}
          className="gap-1.5"
          title="Traite jusqu'à 20 candidatures en attente d'un coup"
        >
          <Play className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
          Traiter les candidatures en attente
        </Button>
      </div>

      {recent.length > 0 ? (
        <ul className="divide-y rounded border bg-background text-xs">
          {recent.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-3 py-2">
              <span className={`w-20 shrink-0 font-medium ${STATUS_TINT[r.status]}`}>
                {STATUS_LABEL[r.status]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  <span className="font-medium">{r.candidate}</span>
                  <span className="text-muted-foreground"> · {r.subject}</span>
                </p>
                {r.detail ? (
                  <p className="truncate text-[11px] text-muted-foreground" title={r.detail}>
                    {r.detail}
                  </p>
                ) : null}
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                {r.repliedAt ? `répondu le ${formatDate(r.repliedAt)}` : formatDate(r.receivedAt)}
              </span>
              {r.status === "error" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => retry(r.id)}
                  disabled={pending}
                  className="h-6 shrink-0 gap-1 px-1.5"
                  title="Remettre en file"
                >
                  <ArrowCounterClockwise className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
