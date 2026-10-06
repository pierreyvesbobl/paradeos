"use client";

import { ArrowsClockwise } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  syncEmailTranscriptsNow,
  updateMeetingsEmailAddress,
  updateMeetingsEmailLabel,
} from "@/lib/actions/email-ingest";

export function EmailTranscriptsForm({
  currentLabel,
  currentAddress,
  suggestedLabel,
  gmailAddress,
}: {
  currentLabel: string | null;
  currentAddress: string | null;
  suggestedLabel: string;
  gmailAddress: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentLabel ?? suggestedLabel);
  const [address, setAddress] = useState(currentAddress ?? "");
  const [pending, startTransition] = useTransition();
  const [savingAddress, startAddressSave] = useTransition();
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

  function saveAddress(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startAddressSave(async () => {
      const res = await updateMeetingsEmailAddress({ address: address.trim() });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(
        address.trim() === "" ? "Adresse dédiée retirée." : "Adresse dédiée enregistrée.",
      );
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
      const {
        ingested,
        transcribed,
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
      } else if (ingested === 0) {
        toast.info("Sync : rien à ingérer.", {
          description:
            skippedDuplicate > 0
              ? `${skippedDuplicate} transcript(s) déjà en base sous une autre source.`
              : skippedUnsupported > 0
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
  const addressUnchanged = address.trim().toLowerCase() === (currentAddress ?? "").trim();
  const aliasSuggestion = gmailAddress ? `reunions@${gmailAddress.split("@")[1]}` : "reunions@…";

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

      <form onSubmit={saveAddress} className="space-y-2 border-t pt-3">
        <Label htmlFor="meetings-email-address" className="text-xs">
          Adresse dédiée (optionnel)
        </Label>
        <div className="flex gap-2">
          <Input
            id="meetings-email-address"
            type="email"
            autoComplete="off"
            spellCheck={false}
            placeholder={aliasSuggestion}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={savingAddress}
            className="font-mono text-sm"
          />
          <Button type="submit" size="sm" disabled={savingAddress || addressUnchanged}>
            {savingAddress ? "…" : "Enregistrer"}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Alias ou groupe Google qui retombe dans la boîte connectée (
          {gmailAddress ?? "compte Google"}) : les mails qui lui sont adressés sont lus directement,
          sans filtre Gmail à écrire. À créer dans la console Google Workspace — aucune modification
          DNS n'est nécessaire, le domaine reçoit déjà son courrier chez Google.
        </p>
      </form>

      {currentLabel ? (
        <div className="space-y-3 border-t pt-3">
          <div className="space-y-1 text-muted-foreground text-xs">
            <p className="font-medium text-foreground">Comment envoyer une réunion</p>
            <p>
              1. Envoie ou transfère le compte-rendu (ou l'audio) à{" "}
              <span className="font-mono">
                {currentAddress ?? gmailAddress ?? "ton adresse Gmail"}
              </span>
              .
            </p>
            <p>
              2. Sans adresse dédiée, range le mail sous{" "}
              <span className="font-mono">{currentLabel}</span> — à la main ou via un filtre Gmail.
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
            <p className="pt-1 font-medium text-foreground">Donner le contexte au passage</p>
            <p>
              En objet, entre crochets :{" "}
              <span className="font-mono">Point hebdo [projet: GpasPlus] [avec: Marie, Éric]</span>.
              Ou en tête du mail, une ligne par information, avant le transcript :
            </p>
            <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
              {
                "Projet : GpasPlus - Automatisation\nParticipants : Marie Testard <marie@fictiva.fr>, Éric\nDate : 12/03/2026\nTitre : Cadrage V2"
              }
            </pre>
            <p>
              Clés acceptées : <span className="font-mono">projet</span>,{" "}
              <span className="font-mono">participants</span> (ou{" "}
              <span className="font-mono">avec</span>), <span className="font-mono">date</span>,{" "}
              <span className="font-mono">titre</span>. Ces lignes ne partent pas dans le
              transcript. Les participants déclarés sont lus par l'extraction, qui cesse de deviner
              qui est « Marie ». Un projet qui ne correspond à rien est ignoré — la réunion arrive
              sans projet, à rattacher en un clic.
            </p>
          </div>
          <div className="flex items-center justify-between gap-2">
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
        </div>
      ) : null}
    </div>
  );
}
