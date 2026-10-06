"use client";

import { ArrowSquareOut, ArrowsClockwise } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { syncDriveTranscriptsNow, updateMeetingsDriveFolder } from "@/lib/actions/drive-ingest";

export function DriveTranscriptsForm({ currentFolderId }: { currentFolderId: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(currentFolderId ?? "");
  const [pending, startTransition] = useTransition();
  const [syncing, startSync] = useTransition();

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateMeetingsDriveFolder({ folder: value.trim() });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(value.trim() === "" ? "Surveillance désactivée." : "Dossier configuré.");
      router.refresh();
    });
  }

  function syncNow() {
    startSync(async () => {
      const res = await syncDriveTranscriptsNow({});
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const {
        ingested,
        skippedExisting,
        skippedDuplicate,
        skippedUnsupported,
        errors,
        errorDetails,
      } = res.data;
      if (errors > 0) {
        toast.error(`Sync : ${errors} erreur(s)`, {
          description: errorDetails.slice(0, 3).join(" · "),
        });
      } else if (ingested === 0 && skippedExisting === 0 && skippedDuplicate === 0) {
        toast.info("Sync : rien à ingérer.", {
          description:
            skippedUnsupported > 0 ? `${skippedUnsupported} fichier(s) ignoré(s).` : undefined,
        });
      } else {
        toast.success(
          ingested > 0
            ? `${ingested} transcript(s) ingéré(s).`
            : `Aucun nouveau (${skippedExisting} déjà ingéré${
                skippedDuplicate > 0 ? `, ${skippedDuplicate} doublon(s) écarté(s)` : ""
              }).`,
          {
            description:
              ingested > 0 && skippedDuplicate > 0
                ? `${skippedDuplicate} doublon(s) écarté(s).`
                : undefined,
          },
        );
      }
      router.refresh();
    });
  }

  const folderUrl = currentFolderId
    ? `https://drive.google.com/drive/folders/${currentFolderId}`
    : null;

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="space-y-2">
        <Label htmlFor="drive-folder" className="text-xs">
          Dossier Drive (URL ou ID)
        </Label>
        <div className="flex gap-2">
          <Input
            id="drive-folder"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://drive.google.com/drive/folders/… ou 1ehwreM27Jr9…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={pending}
            className="font-mono text-sm"
          />
          <Button
            type="submit"
            size="sm"
            disabled={pending || (value.trim() === (currentFolderId ?? "").trim() && value !== "")}
          >
            {pending ? "…" : "Enregistrer"}
          </Button>
        </div>
        {folderUrl ? (
          <a
            href={folderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground hover:underline"
          >
            <ArrowSquareOut className="size-3" />
            Ouvrir le dossier dans Drive
          </a>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Le compte Google admin connecté doit avoir accès à ce dossier (ou un raccourci dans son My
          Drive). Formats supportés : Google Docs, .txt, .md. Le nom que Meet donne à ses fichiers
          («{" "}
          <span className="font-mono">
            Prénom Nom et Prénom Nom - 2026/07/03 10:28 CEST - Transcript
          </span>{" "}
          ») est exploité tel quel : date, heure et participants en sortent. Un transcript déjà en
          base — copie du fichier, ou même réunion arrivée par mail — est écarté.
        </p>
      </form>

      {currentFolderId ? (
        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <span className="text-muted-foreground text-xs">
            Sync auto toutes les 15 min — ou déclenche manuellement :
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={syncNow}
            disabled={syncing}
            className="gap-1.5"
          >
            <ArrowsClockwise className={`size-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sync…" : "Sync now"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
