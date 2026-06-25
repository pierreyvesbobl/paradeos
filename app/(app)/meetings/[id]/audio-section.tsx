"use client";

import { Button } from "@/components/ui/button";
import { deleteAudio } from "@/lib/actions/meeting-audio";
import {
  ArrowClockwise,
  MicrophoneStage,
  SpinnerGap,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { AudioUploadButton } from "./audio-upload-button";

type Status = "idle" | "running" | "done" | "error";

type Props = {
  meetingId: string;
  hasTranscript: boolean;
  audio: {
    fileName: string | null;
    sizeBytes: number | null;
    mimeType: string | null;
  } | null;
  status: Status;
  errorMessage: string | null;
};

export function AudioSection({ meetingId, hasTranscript, audio, status, errorMessage }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [retrying, setRetrying] = useState(false);

  // Quand la transcription est en cours, on rafraîchit la page toutes
  // les 5s pour récupérer l'état mis à jour (le POST côté client est
  // synchrone mais l'utilisateur peut avoir rechargé la page entretemps).
  useEffect(() => {
    if (status !== "running") return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [status, router]);

  async function onRetry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/transcribe`, { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        transcriptLength?: number;
        proposalCount?: number;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Transcription échouée.");
      toast.success(
        `Transcript généré (${json.transcriptLength ?? 0} car.) — ${json.proposalCount ?? 0} propositions.`,
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur transcription.");
    } finally {
      setRetrying(false);
    }
  }

  function onDelete() {
    if (!window.confirm("Supprimer le fichier audio source ? Le transcript déjà généré reste.")) {
      return;
    }
    startTransition(async () => {
      const res = await deleteAudio({ meetingId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Audio supprimé.");
      router.refresh();
    });
  }

  // Pas d'audio attaché → CTA d'upload
  if (!audio?.fileName) {
    return (
      <section className="rounded-xl border bg-[var(--ds-bg-surface)] p-5">
        <header className="mb-3 flex items-center gap-3">
          <MicrophoneStage size={18} weight="duotone" className="text-muted-foreground" />
          <h2 className="font-semibold text-[15px] text-foreground">Audio source</h2>
        </header>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-muted-foreground">
            Importe un fichier audio pour générer le transcript automatiquement (Whisper, 25 Mo
            max).
          </p>
          <AudioUploadButton meetingId={meetingId} confirmReplace={hasTranscript} />
        </div>
      </section>
    );
  }

  // Audio attaché → afficher infos + état
  return (
    <section className="rounded-xl border bg-[var(--ds-bg-surface)] p-5">
      <header className="mb-3 flex items-center gap-3">
        <MicrophoneStage size={18} weight="duotone" className="text-muted-foreground" />
        <h2 className="font-semibold text-[15px] text-foreground">Audio source</h2>
        <StatusBadge status={status} />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-[14px] text-foreground">{audio.fileName}</div>
          <div className="text-[12px] text-muted-foreground">
            {formatBytes(audio.sizeBytes)}
            {audio.mimeType ? ` · ${audio.mimeType}` : ""}
          </div>
        </div>

        {status === "running" ? (
          <span className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
            <SpinnerGap size={14} className="animate-spin" />
            Transcription en cours…
          </span>
        ) : null}

        {status === "error" ? (
          <Button type="button" size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
            <ArrowClockwise size={16} />
            {retrying ? "Relance…" : "Réessayer"}
          </Button>
        ) : null}

        {status === "done" || status === "error" || status === "idle" ? (
          <>
            <AudioUploadButton
              meetingId={meetingId}
              label="Remplacer"
              confirmReplace={hasTranscript}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={pending}
              onClick={onDelete}
            >
              <Trash size={16} />
              {pending ? "Suppression…" : "Supprimer"}
            </Button>
          </>
        ) : null}
      </div>

      {status === "error" && errorMessage ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-[var(--ds-tint-red-bg)] bg-[var(--ds-tint-red-bg)] px-3 py-2 text-[12px] text-[var(--ds-tint-red-text)]">
          <WarningCircle size={14} weight="duotone" className="mt-0.5 shrink-0" />
          <span>{errorMessage}</span>
        </p>
      ) : null}
    </section>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; tint: "gray" | "yellow" | "green" | "red" }> = {
    idle: { label: "Non transcrit", tint: "gray" },
    running: { label: "En cours", tint: "yellow" },
    done: { label: "Transcrit", tint: "green" },
    error: { label: "Erreur", tint: "red" },
  };
  const { label, tint } = map[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold text-[11px]"
      style={{
        background: `var(--ds-tint-${tint}-bg)`,
        color: `var(--ds-tint-${tint}-text)`,
      }}
    >
      <span
        className="inline-block size-1.5 rounded-full"
        style={{ background: `var(--ds-tint-${tint}-dot)` }}
      />
      {label}
    </span>
  );
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(1)} Mo`;
  return `${(bytes / 1024).toFixed(0)} Ko`;
}
