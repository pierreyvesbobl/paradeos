"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createMeeting, extractMeetingProposals } from "@/lib/actions/meetings";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export function NewMeetingForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [transcript, setTranscript] = useState("");
  const [pending, startTransition] = useTransition();

  async function readFile(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(f);
    });
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
    readFile(file)
      .then((text) => setTranscript(text))
      .catch(() => toast.error("Impossible de lire le fichier."));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const created = await createMeeting({
        title: title.trim(),
        transcript: transcript.trim(),
        occurredAt: occurredAt || undefined,
        sourceLabel: sourceLabel.trim() || undefined,
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

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-lg border bg-card p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="title">Titre</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Sync hebdo Acme — 2026-05-04"
            required
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="occurredAt">Date du meeting</Label>
          <Input
            id="occurredAt"
            type="date"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sourceLabel">Source (optionnel)</Label>
          <Input
            id="sourceLabel"
            value={sourceLabel}
            onChange={(e) => setSourceLabel(e.target.value)}
            placeholder="Drive, Granola, Otter…"
            disabled={pending}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="file">Fichier transcript (optionnel)</Label>
        <Input
          id="file"
          type="file"
          accept=".txt,.vtt,.srt,.md"
          onChange={onFileChange}
          disabled={pending}
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
          disabled={pending}
          className="block w-full rounded-md border bg-background p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-muted-foreground text-xs">
          {transcript.length.toLocaleString("fr-FR")} caractères
        </p>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={pending || !title || transcript.length < 20}>
          {pending ? "Traitement…" : "Enregistrer et extraire"}
        </Button>
      </div>
    </form>
  );
}
