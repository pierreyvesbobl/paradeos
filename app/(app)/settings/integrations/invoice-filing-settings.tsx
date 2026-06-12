"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  processAllPendingFilings,
  setInvoiceFilingEnabled,
  setInvoiceFilingRootFolder,
} from "@/lib/actions/invoice-filings";
import { Play, Power, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Extrait l'ID d'un dossier depuis une URL Google Drive collée par
 * l'utilisateur, ou retourne la valeur telle quelle si elle ressemble
 * déjà à un ID brut.
 *
 *   https://drive.google.com/drive/folders/1TY3Dv… → 1TY3Dv…
 *   1TY3Dv…                                       → 1TY3Dv…
 */
function parseDriveFolderId(input: string): string {
  const match = input.match(/\/folders\/([A-Za-z0-9_-]+)/);
  return (match?.[1] ?? input).trim();
}

type Props = {
  currentFolderId: string | null;
  enabled: boolean;
};

export function InvoiceFilingSettings({ currentFolderId, enabled }: Props) {
  const router = useRouter();
  const [folderInput, setFolderInput] = useState(currentFolderId ?? "");
  const [pending, startTransition] = useTransition();

  function saveFolder() {
    const id = parseDriveFolderId(folderInput);
    if (!id) {
      toast.error("ID de dossier vide.");
      return;
    }
    startTransition(async () => {
      const res = await setInvoiceFilingRootFolder({ folderId: id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setFolderInput(id);
      toast.success("Dossier racine enregistré.");
      router.refresh();
    });
  }

  function toggleEnabled() {
    startTransition(async () => {
      const res = await setInvoiceFilingEnabled({ enabled: !enabled });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(enabled ? "Agent désactivé." : "Agent activé.");
      router.refresh();
    });
  }

  function drainPending() {
    startTransition(async () => {
      const res = await processAllPendingFilings({});
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(
        `Classées : ${res.data.filed} · Écartées : ${res.data.rejected} · Erreurs : ${res.data.error}`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="folder-id" className="font-medium text-[11px]">
          Dossier Drive racine (Parade)
        </label>
        <div className="flex items-center gap-1.5">
          <Input
            id="folder-id"
            value={folderInput}
            onChange={(e) => setFolderInput(e.target.value)}
            placeholder="Colle l'URL du dossier Drive ou son ID"
            disabled={pending}
            className="h-8 font-mono text-xs"
          />
          <Button
            type="button"
            size="sm"
            onClick={saveFolder}
            disabled={pending || !folderInput.trim()}
            className="gap-1.5"
          >
            <Save className="size-3.5" />
            Enregistrer
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          L'agent crée <code>YYYY/Fournisseur/</code> dedans à chaque facture.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
          disabled={pending || !currentFolderId || !enabled}
          className="gap-1.5"
          title="Traite jusqu'à 20 filings en attente d'un coup"
        >
          <Play className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
          Drainer les pendings
        </Button>
        <Button asChild size="sm" variant="ghost" className="gap-1.5">
          <Link href="/compta?tab=factures">Voir l'audit log</Link>
        </Button>
      </div>
    </div>
  );
}
