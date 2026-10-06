"use client";

import { FloppyDisk } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setSalesInvoiceDriveFolder } from "@/lib/actions/integrations";

export function SalesInvoiceDriveSettings({ currentFolderId }: { currentFolderId: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(currentFolderId ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await setSalesInvoiceDriveFolder({ folderIdOrUrl: value });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setValue(res.data.folderId ?? "");
      toast.success(res.data.folderId ? "Dossier enregistré." : "Classement désactivé.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="URL du dossier Drive, ou son identifiant"
          className="max-w-xl font-mono text-xs"
          disabled={pending}
        />
        <Button size="sm" disabled={pending} onClick={save}>
          <FloppyDisk className="mr-1.5 size-4" />
          Enregistrer
        </Button>
        {currentFolderId ? (
          <Link
            href={`https://drive.google.com/drive/folders/${currentFolderId}`}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground text-xs underline"
          >
            Ouvrir le dossier
          </Link>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Ouvre <code>Parade/Admin/Comptabilité/Factures Ventes</code> dans Drive et colle l'URL de la
        barre d'adresse. Champ vide = pas de classement.
      </p>
    </div>
  );
}
