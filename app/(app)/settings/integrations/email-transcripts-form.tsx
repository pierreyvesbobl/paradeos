"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { syncEmailTranscriptsNow, updateMeetingsEmailLabel } from "@/lib/actions/email-ingest";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export function EmailTranscriptsForm({
  currentLabel,
  suggestedLabel,
  gmailAddress,
}: {
  currentLabel: string | null;
  suggestedLabel: string;
  gmailAddress: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentLabel ?? suggestedLabel);
  const [pending, startTransition] = useTransition();
  const [syncing, startSync] = useTransition();

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateMeetingsEmailLabel({ label: value.trim() });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if (value.trim() === "") {
        toast.success("Ingestion par mail désactivée.");
      } else {
        toast.success(
          res.data.labelCreated ? "Label créé dans Gmail." : "Label surveillé enregistré.",
        );
      }
      router.refresh();
    });
  }

  function syncNow() {
    startSync(async () => {
      const res = await syncEmailTranscriptsNow({});
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const { ingested, transcribed, skippedExisting, skippedUnsupported, errors, errorDetails } =
        res.data;
      if (errors > 0) {
        toast.error(`Sync : ${errors} erreur(s)`, {
          description: errorDetails.slice(0, 3).join(" · "),
        });
      } else if (ingested === 0) {
        toast.info("Sync : rien à ingérer.", {
          description:
            skippedUnsupported > 0
              ? `${skippedUnsupported} mail(s) sans transcript exploitable.`
              : skippedExisting > 0
                ? `${skippedExisting} mail(s) déjà traité(s).`
                : undefined,
        });
      } else {
        toast.success(`${ingested} réunion(s) créée(s).`, {
          description: transcribed > 0 ? `dont ${transcribed} audio transcrit(s).` : undefined,
        });
      }
      router.refresh();
    });
  }

  const unchanged = value.trim() === (currentLabel ?? "").trim();

  return (
    <div className="space-y-4">
      <form onSubmit={save} className="space-y-2">
        <Label htmlFor="meetings-email-label" className="text-xs">
          Label Gmail surveillé
        </Label>
        <div className="flex gap-2">
          <Input
            id="meetings-email-label"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={suggestedLabel}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={pending}
            className="font-mono text-sm"
          />
          <Button type="submit" size="sm" disabled={pending || unchanged}>
            {pending ? "…" : "Enregistrer"}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Le label est créé dans Gmail à l'enregistrement. Vide le champ pour désactiver.
        </p>
      </form>

      {currentLabel ? (
        <div className="space-y-3 border-t pt-3">
          <div className="space-y-1 text-muted-foreground text-xs">
            <p className="font-medium text-foreground">Comment envoyer une réunion</p>
            <p>
              1. Transfère le compte-rendu ou l'audio à{" "}
              <span className="font-mono">{gmailAddress ?? "ton adresse Gmail"}</span>.
            </p>
            <p>
              2. Range le mail sous <span className="font-mono">{currentLabel}</span> — à la main,
              ou via un filtre Gmail (par exemple sur un alias{" "}
              <span className="font-mono">
                {gmailAddress ? gmailAddress.replace("@", "+reunion@") : "toi+reunion@gmail.com"}
              </span>
              ) pour que ce soit automatique.
            </p>
            <p>
              3. Au run suivant, la réunion apparaît dans Réunions avec ses propositions, et le mail
              passe sous <span className="font-mono">{currentLabel}/Traité</span>.
            </p>
            <p>
              Audio : 25 Mo maximum (limite Whisper), formats mp3, m4a, mp4, wav, webm, ogg, flac.
              Un mail sans transcript exploitable passe sous{" "}
              <span className="font-mono">{currentLabel}/Ignoré</span> plutôt que de bloquer la
              file.
            </p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">
              Sync auto toutes les 30 min — ou déclenche manuellement :
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
        </div>
      ) : null}
    </div>
  );
}
