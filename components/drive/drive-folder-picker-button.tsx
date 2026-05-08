"use client";

import { Button } from "@/components/ui/button";
import { linkDriveFolder } from "@/lib/actions/drive-folders";
import type { DriveFileSubjectType } from "@/lib/schemas/drive-files";
import { FolderOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useCallback, useState } from "react";
import { toast } from "sonner";

/**
 * Bouton « Lier un dossier Drive existant » : ouvre le Google Picker
 * filtré sur les dossiers (`mimeType=application/vnd.google-apps.folder`)
 * et persiste le lien.
 */

type GoogleNS = {
  picker: {
    PickerBuilder: new () => GooglePickerBuilder;
    DocsView: new (viewId?: unknown) => GoogleDocsView;
    ViewId: { FOLDERS: unknown };
    Action: { PICKED: string };
    Feature: { NAV_HIDDEN: string };
  };
};

type GooglePickerBuilder = {
  setOAuthToken: (t: string) => GooglePickerBuilder;
  setDeveloperKey: (k: string) => GooglePickerBuilder;
  addView: (v: GoogleDocsView) => GooglePickerBuilder;
  enableFeature: (f: string) => GooglePickerBuilder;
  setCallback: (cb: (data: PickerCallbackData) => void) => GooglePickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
};

type GoogleDocsView = {
  setMimeTypes: (m: string) => GoogleDocsView;
  setSelectFolderEnabled: (b: boolean) => GoogleDocsView;
  setIncludeFolders: (b: boolean) => GoogleDocsView;
};

type PickedDoc = {
  id: string;
  name: string;
  mimeType?: string;
  url?: string;
};

type PickerCallbackData = {
  action: string;
  docs?: PickedDoc[];
};

declare global {
  interface Window {
    gapi?: { load: (n: string, opts: { callback: () => void }) => void };
    google?: GoogleNS;
  }
}

const SCRIPT_URL = "https://apis.google.com/js/api.js";

type Props = {
  subjectType: DriveFileSubjectType;
  subjectId: string;
  developerKey: string | null;
  variant?: "default" | "outline" | "ghost";
};

export function DriveFolderPickerButton({
  subjectType,
  subjectId,
  developerKey,
  variant = "outline",
}: Props) {
  const router = useRouter();
  const [scriptReady, setScriptReady] = useState(false);
  const [opening, setOpening] = useState(false);

  const openPicker = useCallback(async () => {
    if (opening) return;
    setOpening(true);

    try {
      const tokenRes = await fetch("/api/google/access-token", { cache: "no-store" });
      if (!tokenRes.ok) {
        toast.error("Reconnecte Google Drive depuis Réglages → Intégrations.");
        return;
      }
      const { accessToken } = (await tokenRes.json()) as { accessToken: string };

      if (!window.gapi) {
        toast.error("Google API non chargée. Recharge la page.");
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("picker_load_timeout")), 10_000);
        window.gapi?.load("picker", {
          callback: () => {
            clearTimeout(timer);
            resolve();
          },
        });
      });

      if (!window.google?.picker) {
        toast.error("Module Picker indisponible. Active la Picker API dans Google Cloud.");
        return;
      }

      const folderView = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
        .setMimeTypes("application/vnd.google-apps.folder")
        .setSelectFolderEnabled(true);

      let builder = new window.google.picker.PickerBuilder()
        .setOAuthToken(accessToken)
        .addView(folderView)
        .setCallback(async (data) => {
          if (data.action !== window.google?.picker.Action.PICKED) return;
          const doc = data.docs?.[0];
          if (!doc) return;

          const res = await linkDriveFolder({
            subjectType,
            subjectId,
            folderId: doc.id,
            folderName: doc.name,
            folderUrl: doc.url ?? null,
          });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success(`Dossier « ${doc.name} » lié.`);
          router.refresh();
        });

      if (developerKey) builder = builder.setDeveloperKey(developerKey);

      builder.build().setVisible(true);
    } catch (err) {
      console.error("[drive folder picker]", err);
      toast.error("Impossible d'ouvrir le picker Drive.");
    } finally {
      setOpening(false);
    }
  }, [opening, subjectType, subjectId, developerKey, router]);

  return (
    <>
      <Script src={SCRIPT_URL} strategy="afterInteractive" onReady={() => setScriptReady(true)} />
      <Button
        type="button"
        size="sm"
        variant={variant}
        onClick={openPicker}
        disabled={opening}
        className="gap-1.5"
      >
        <FolderOpen className="size-3.5" />
        {opening ? "…" : !scriptReady ? "Chargement…" : "Lier un dossier"}
      </Button>
    </>
  );
}
