"use client";

import { Button } from "@/components/ui/button";
import { attachAudio, signedAudioUploadUrl } from "@/lib/actions/meeting-audio";
import { AUDIO_MAX_BYTES } from "@/lib/schemas/meeting-audio";
import { UploadSimple } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

type Props = {
  meetingId: string;
  /** Label optionnel du bouton (par défaut « Importer un audio »). */
  label?: string;
  /** Si transcript déjà présent, on confirme avant remplacement. */
  confirmReplace?: boolean;
};

const ACCEPT = "audio/*,.mp3,.m4a,.wav,.webm,.mp4,.mpeg,.mpga,.ogg,.oga,.flac";

export function AudioUploadButton({ meetingId, label, confirmReplace }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | "uploading" | "transcribing">(null);

  async function handleFile(file: File) {
    if (file.size > AUDIO_MAX_BYTES) {
      toast.error(
        `Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)} Mo). Limite : 25 Mo.`,
      );
      return;
    }
    if (confirmReplace) {
      const ok = window.confirm(
        "Un transcript existe déjà. L'import audio va le remplacer et relancer l'extraction. Continuer ?",
      );
      if (!ok) return;
    }

    setBusy("uploading");
    try {
      const signed = await signedAudioUploadUrl({ meetingId, fileName: file.name });
      if (!signed.ok) throw new Error(signed.message);

      const put = await fetch(signed.data.signedUrl, {
        method: "PUT",
        body: file,
        headers: file.type ? { "Content-Type": file.type } : undefined,
      });
      if (!put.ok) throw new Error(`Upload Storage échoué (${put.status}).`);

      const attached = await attachAudio({
        meetingId,
        storagePath: signed.data.path,
        fileName: file.name,
        mimeType: file.type || undefined,
        sizeBytes: file.size,
      });
      if (!attached.ok) throw new Error(attached.message);

      setBusy("transcribing");
      const res = await fetch(`/api/meetings/${meetingId}/transcribe`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        transcriptLength?: number;
        proposalCount?: number;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Transcription échouée.");
      }

      toast.success(
        `Transcript généré (${json.transcriptLength ?? 0} car.) — ${json.proposalCount ?? 0} propositions.`,
      );
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur upload.";
      toast.error(message);
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        disabled={busy !== null}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy !== null}
        onClick={() => inputRef.current?.click()}
      >
        <UploadSimple size={16} weight="duotone" />
        {busy === "uploading"
          ? "Upload…"
          : busy === "transcribing"
            ? "Transcription…"
            : (label ?? "Importer un audio")}
      </Button>
    </>
  );
}
