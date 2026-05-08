"use client";

import { Button } from "@/components/ui/button";
import { unlinkDriveFolder } from "@/lib/actions/drive-folders";
import type { DriveFileSubjectType } from "@/lib/schemas/drive-files";
import { ExternalLink, FolderOpen, HelpCircle, Link2Off } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DriveLocalOpenSetupDialog } from "./drive-local-open-setup-dialog";

/** Nom de l'Apple Shortcut que l'utilisateur doit avoir installée. */
const APPLE_SHORTCUT_NAME = "Paradeos Open Folder";

/**
 * Boutons d'action sur un dossier Drive lié :
 * - "Ouvrir dans Drive" → web (drive.google.com)
 * - "Ouvrir en local" → tente d'ouvrir Finder via une Apple Shortcut
 *   (`shortcuts://run-shortcut`), qui n'est pas bloqué par le navigateur
 *   contrairement à `file://`. Fallback : copie le chemin au presse-papier
 *   pour ⇧⌘G dans Finder.
 * - "Délier" → supprime le lien (le dossier reste dans Drive).
 */
export function DriveFolderActions({
  subjectType,
  subjectId,
  folderUrl,
  localPath,
}: {
  subjectType: DriveFileSubjectType;
  subjectId: string;
  folderUrl: string | null;
  localPath: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [setupOpen, setSetupOpen] = useState(false);

  function unlink() {
    if (!window.confirm("Délier ce dossier ? Il restera dans Drive.")) return;
    startTransition(async () => {
      const res = await unlinkDriveFolder({ subjectType, subjectId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Dossier délié.");
      router.refresh();
    });
  }

  async function openLocal() {
    if (!localPath) return;

    // Toujours copier le chemin au presse-papier (fallback si la
    // Shortcut n'est pas installée).
    try {
      await navigator.clipboard.writeText(localPath);
    } catch {
      // Pas de clipboard (rare en dev/iframe) — on continue quand même.
    }

    // Trigger l'Apple Shortcut avec le chemin tel quel (`~/...`). Le
    // shell script du Shortcut doit expandre le tilde lui-même.
    const url = `shortcuts://run-shortcut?name=${encodeURIComponent(APPLE_SHORTCUT_NAME)}&input=text&text=${encodeURIComponent(localPath)}`;

    // Anchor click déclenche le custom URL scheme sans naviguer la page
    // ni ouvrir un popup.
    const a = document.createElement("a");
    a.href = url;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();

    toast.success("Tentative d'ouverture en local", {
      description: `Si rien ne s'ouvre, configure l'Apple Shortcut « ${APPLE_SHORTCUT_NAME} » (clic ?). Le chemin a été copié au presse-papier en fallback.`,
      duration: 6000,
    });
  }

  return (
    <div className="flex items-center gap-1">
      {folderUrl ? (
        <Button asChild type="button" size="sm" variant="outline" className="gap-1.5">
          <a href={folderUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-3.5" />
            Ouvrir dans Drive
          </a>
        </Button>
      ) : null}
      {localPath ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openLocal}
            className="gap-1.5"
            title={localPath}
          >
            <FolderOpen className="size-3.5" />
            Ouvrir en local
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setSetupOpen(true)}
            title="Configurer l'ouverture 1-clic"
            aria-label="Aide configuration"
          >
            <HelpCircle className="size-3.5" />
          </Button>
          <DriveLocalOpenSetupDialog
            open={setupOpen}
            onClose={() => setSetupOpen(false)}
            shortcutName={APPLE_SHORTCUT_NAME}
          />
        </>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={unlink}
        disabled={pending}
        title="Délier le dossier"
        aria-label="Délier le dossier"
      >
        <Link2Off className="size-3.5" />
      </Button>
    </div>
  );
}
