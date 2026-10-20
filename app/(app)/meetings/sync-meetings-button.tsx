"use client";

import { ArrowsClockwise, CaretDown, EnvelopeSimple, GoogleDriveLogo } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { syncDriveTranscriptsNow } from "@/lib/actions/drive-ingest";
import { syncEmailTranscriptsNow } from "@/lib/actions/email-ingest";

type Source = "drive" | "email";

const SOURCE_LABEL: Record<Source, string> = {
  drive: "Drive",
  email: "Mail",
};

/**
 * Déclenche à la main ce que les crons font toutes les quelques heures :
 * relire le dossier Drive de Meet ou la boîte des réunions, et créer ce
 * qui manque. Le bilan arrive en toast. Un transcript déjà en base est
 * écarté par le pipeline lui-même (même fichier, même empreinte, même
 * créneau), ce bouton ne crée donc pas de doublon d'une réunion déjà
 * passée.
 */
export function SyncMeetingsButton() {
  const router = useRouter();
  const [running, setRunning] = useState<Source | null>(null);
  const [, startTransition] = useTransition();

  function run(source: Source) {
    setRunning(source);
    startTransition(async () => {
      try {
        const res =
          source === "drive"
            ? await syncDriveTranscriptsNow({})
            : await syncEmailTranscriptsNow({});
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        const { ingested, skippedExisting, skippedDuplicate, errors, errorDetails } = res.data;
        const label = SOURCE_LABEL[source];
        if (errors > 0) {
          toast.error(`${label} : ${errors} erreur(s)`, {
            description: errorDetails.slice(0, 3).join(" · "),
          });
        } else if (ingested > 0) {
          toast.success(`${label} : ${ingested} réunion(s) récupérée(s).`, {
            description:
              skippedDuplicate > 0 ? `${skippedDuplicate} doublon(s) écarté(s).` : undefined,
          });
        } else {
          toast.info(`${label} : rien de nouveau.`, {
            description:
              skippedExisting + skippedDuplicate > 0
                ? `${skippedExisting} déjà en base${
                    skippedDuplicate > 0 ? `, ${skippedDuplicate} doublon(s) écarté(s)` : ""
                  }.`
                : undefined,
          });
        }
        router.refresh();
      } finally {
        setRunning(null);
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" disabled={running !== null} className="gap-1.5">
          <ArrowsClockwise className={`size-4 ${running ? "animate-spin" : ""}`} />
          {running ? `Récupération ${SOURCE_LABEL[running]}…` : "Récupérer"}
          {running ? null : <CaretDown className="size-3.5 opacity-60" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <DropdownMenuItem onSelect={() => run("drive")} className="flex items-center gap-2">
          <GoogleDriveLogo className="size-4" />
          Depuis le Drive (Meet)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("email")} className="flex items-center gap-2">
          <EnvelopeSimple className="size-4" />
          Depuis les mails
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
