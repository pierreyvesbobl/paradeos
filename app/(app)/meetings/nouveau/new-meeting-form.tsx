"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { attachAudio, signedAudioUploadUrl } from "@/lib/actions/meeting-audio";
import { createMeeting, extractMeetingProposals } from "@/lib/actions/meetings";
import { AUDIO_MAX_BYTES } from "@/lib/schemas/meeting-audio";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

type Props = {
  projects: { id: string; name: string }[];
};

type Mode = "text" | "audio";

const AUDIO_ACCEPT = "audio/*,.mp3,.m4a,.wav,.webm,.mp4,.mpeg,.mpga,.ogg,.oga,.flac";

export function NewMeetingForm({ projects }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("text");
  const [title, setTitle] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [transcript, setTranscript] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<null | "uploading" | "transcribing">(null);

  async function readFile(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(f);
    });
  }

  function onTextFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
    readFile(file)
      .then((text) => setTranscript(text))
      .catch(() => toast.error("Impossible de lire le fichier."));
  }

  function onAudioFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file && file.size > AUDIO_MAX_BYTES) {
      toast.error(
        `Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)} Mo). Limite : 25 Mo.`,
      );
      e.target.value = "";
      return;
    }
    if (file && !title) setTitle(file.name.replace(/\.[^.]+$/, ""));
    setAudioFile(file);
  }

  function onSubmitText(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const created = await createMeeting({
        title: title.trim(),
        transcript: transcript.trim(),
        occurredAt: occurredAt || undefined,
        sourceLabel: sourceLabel.trim() || undefined,
        projectId: projectId ?? undefined,
      });
      if (!created.ok) {
        toast.error(created.message);
        return;
      }
      const id = created.data.id;
      if (!id) {
        toast.error("Identifiant non retourné.");
        return;
      }
      toast.success("Meeting enregistré, extraction en cours…");
      const extracted = await extractMeetingProposals({ meetingId: id });
      if (!extracted.ok) {
        toast.error(`Extraction échouée : ${extracted.message}`);
        router.push(`/meetings/${id}`);
        return;
      }
      toast.success(`${extracted.data.count} propositions extraites.`);
      router.push(`/meetings/${id}`);
      router.refresh();
    });
  }

  function onSubmitAudio(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!audioFile) {
      toast.error("Sélectionne un fichier audio.");
      return;
    }
    const file = audioFile;
    startTransition(async () => {
      // 1. Crée la réunion (sans transcript — Whisper va le remplir).
      const created = await createMeeting({
        title: title.trim(),
        transcript: "",
        occurredAt: occurredAt || undefined,
        sourceLabel: sourceLabel.trim() || file.name,
        projectId: projectId ?? undefined,
      });
      if (!created.ok) {
        toast.error(created.message);
        return;
      }
      const id = created.data.id;
      if (!id) {
        toast.error("Identifiant non retourné.");
        return;
      }

      try {
        setBusy("uploading");
        const signed = await signedAudioUploadUrl({ meetingId: id, fileName: file.name });
        if (!signed.ok) throw new Error(signed.message);

        const put = await fetch(signed.data.signedUrl, {
          method: "PUT",
          body: file,
          headers: file.type ? { "Content-Type": file.type } : undefined,
        });
        if (!put.ok) throw new Error(`Upload Storage échoué (${put.status}).`);

        const attached = await attachAudio({
          meetingId: id,
          storagePath: signed.data.path,
          fileName: file.name,
          mimeType: file.type || undefined,
          sizeBytes: file.size,
        });
        if (!attached.ok) throw new Error(attached.message);

        setBusy("transcribing");
        const res = await fetch(`/api/meetings/${id}/transcribe`, { method: "POST" });
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
        router.push(`/meetings/${id}`);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erreur upload.";
        toast.error(message);
        // La réunion est créée — on emmène l'utilisateur dessus pour qu'il
        // puisse retenter (réessayer la transcription) plutôt que de la
        // perdre dans un état orphelin.
        router.push(`/meetings/${id}`);
      } finally {
        setBusy(null);
      }
    });
  }

  const formDisabled = pending || busy !== null;

  return (
    <div className="space-y-5 rounded-lg border bg-card p-6">
      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
        <TabsList>
          <TabsTrigger value="text">Coller le texte</TabsTrigger>
          <TabsTrigger value="audio">Importer un audio</TabsTrigger>
        </TabsList>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="title">Titre</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sync hebdo Acme — 2026-05-04"
              required
              disabled={formDisabled}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="occurredAt">Date du meeting</Label>
            <DateInput
              id="occurredAt"
              value={occurredAt}
              onValueChange={setOccurredAt}
              disabled={formDisabled}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sourceLabel">Source (optionnel)</Label>
            <Input
              id="sourceLabel"
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
              placeholder="Drive, Granola, Otter, enregistrement direct…"
              disabled={formDisabled}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="projectId">Projet / deal lié (optionnel)</Label>
            <FkCombobox
              id="projectId"
              value={projectId}
              onValueChange={setProjectId}
              options={projects.map((p) => ({ id: p.id, label: p.name }))}
              searchPlaceholder="Rechercher un projet ou deal…"
              disabled={formDisabled}
            />
            <p className="text-muted-foreground text-xs">
              Le projet couvre tout le cycle (deal commercial → delivery). Le rattachement aide à
              retrouver le transcript depuis la fiche correspondante.
            </p>
          </div>
        </div>

        <TabsContent value="text">
          <form onSubmit={onSubmitText} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="file">Fichier transcript (optionnel)</Label>
              <Input
                id="file"
                type="file"
                accept=".txt,.vtt,.srt,.md"
                onChange={onTextFileChange}
                disabled={formDisabled}
              />
              <p className="text-muted-foreground text-xs">
                Le contenu sera collé dans la zone ci-dessous. Tu peux aussi coller directement.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="transcript">Transcript</Label>
              <textarea
                id="transcript"
                rows={16}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Colle le transcript ici…"
                required
                disabled={formDisabled}
                className="block w-full rounded-md border bg-background p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-muted-foreground text-xs">
                {transcript.length.toLocaleString("fr-FR")} caractères
              </p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="submit" disabled={formDisabled || !title || transcript.length < 20}>
                {pending ? "Traitement…" : "Enregistrer et extraire"}
              </Button>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="audio">
          <form onSubmit={onSubmitAudio} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="audio">Fichier audio</Label>
              <Input
                ref={audioInputRef}
                id="audio"
                type="file"
                accept={AUDIO_ACCEPT}
                onChange={onAudioFileChange}
                disabled={formDisabled}
                required
              />
              <p className="text-muted-foreground text-xs">
                Formats : mp3, m4a, wav, webm, ogg, flac. Limite : 25 Mo (≈ 45 min en 64 kbps).
                Transcription via OpenAI Whisper, puis extraction automatique des tâches / contacts
                / projets.
              </p>
              {audioFile ? (
                <p className="text-foreground text-xs">
                  <span className="font-medium">{audioFile.name}</span>{" "}
                  <span className="text-muted-foreground">
                    · {(audioFile.size / 1024 / 1024).toFixed(1)} Mo
                  </span>
                </p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button type="submit" disabled={formDisabled || !title || !audioFile}>
                {busy === "uploading"
                  ? "Upload…"
                  : busy === "transcribing"
                    ? "Transcription…"
                    : pending
                      ? "Traitement…"
                      : "Importer et transcrire"}
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}
