import { driveFolders } from "@/db/schema/drive-folders";
import { requireUser } from "@/lib/auth/server";
import { getDriveFolderForSubject } from "@/lib/db/queries/drive-folders";
import { db } from "@/lib/db/server";
import { getGoogleAccount, getValidAccessToken } from "@/lib/google/account";
import { type DriveFile, listFolderChildren, resolveFolderPath } from "@/lib/google/drive-api";
import type { DriveFileSubjectType } from "@/lib/schemas/drive-files";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { DriveFolderActions } from "./drive-folder-actions";
import { DriveFolderChildrenList } from "./drive-folder-children-list";
import { DriveFolderCreateDialog } from "./drive-folder-create-dialog";
import { DriveFolderPickerButton } from "./drive-folder-picker-button";

/**
 * Section "Drive" pour un sujet métier. Affiche :
 *   - Pas de dossier → CTA pour lier un existant ou créer un nouveau
 *   - Dossier lié → nom du dossier + boutons (ouvrir Drive / local /
 *     délier) + liste des fichiers/dossiers enfants (via API Drive)
 *
 * Si Drive n'est pas connecté, propose un lien vers les réglages.
 */
export async function DriveFolderSection({
  subjectType,
  subjectId,
  defaultFolderName,
  className,
}: {
  subjectType: DriveFileSubjectType;
  subjectId: string;
  defaultFolderName: string;
  className?: string;
}) {
  const user = await requireUser();
  const [account, link] = await Promise.all([
    getGoogleAccount(user.id),
    getDriveFolderForSubject(subjectType, subjectId),
  ]);

  const developerKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? null;

  if (!account) {
    return (
      <section className={className ?? "space-y-2"}>
        <Header />
        <p className="text-muted-foreground text-xs">
          <Link href="/settings/integrations" className="underline">
            Connecter Google Drive
          </Link>{" "}
          pour lier un dossier à ce projet.
        </p>
      </section>
    );
  }

  if (!link) {
    return (
      <section className={className ?? "space-y-2"}>
        <Header />
        <div className="flex flex-wrap items-center gap-2">
          <DriveFolderPickerButton
            subjectType={subjectType}
            subjectId={subjectId}
            developerKey={developerKey}
          />
          <DriveFolderCreateDialog
            subjectType={subjectType}
            subjectId={subjectId}
            defaultName={defaultFolderName}
          />
        </div>
      </section>
    );
  }

  let displayPath = link.folderPath;
  let localPath = link.folderLocalPath;
  let children: DriveFile[] = [];
  let listError: string | null = null;
  try {
    const accessToken = await getValidAccessToken(user.id);
    if (accessToken) {
      children = await listFolderChildren(link.folderId, accessToken);

      // Lazy fix : recalcule les chemins si l'un d'eux manque (cas
      // typique : link initial fait avant `drive.readonly`, ou avant
      // que la détection des raccourcis n'existe). On persiste pour ne
      // pas refaire le calcul à chaque rendu.
      if (!displayPath || !localPath) {
        try {
          const resolved = await resolveFolderPath(link.folderId, accessToken);
          if (resolved) {
            displayPath = resolved.displayPath;
            localPath = resolved.localPath;
            const conn = await db();
            await conn
              .update(driveFolders)
              .set({
                folderPath: resolved.displayPath,
                folderLocalPath: resolved.localPath,
                updatedAt: new Date(),
              })
              .where(eq(driveFolders.id, link.id));
          }
        } catch (err) {
          console.warn("[drive folder section] resolve path failed", err);
        }
      }
    }
  } catch (err) {
    // `console.warn` plutôt que `error` pour ne pas trigger l'overlay
    // Next dev — on a déjà un message utilisateur sous l'entête.
    console.warn("[drive folder section] list failed", err);
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("404")) {
      listError = "Le dossier n'est plus accessible (déplacé ou supprimé).";
    } else if (msg.includes("SERVICE_DISABLED") || msg.includes("accessNotConfigured")) {
      listError = "Active la Google Drive API dans Google Cloud Console (puis attends ~1 min).";
    } else if (msg.includes("403") || msg.includes("PERMISSION_DENIED")) {
      listError = "Accès refusé — reconnecte Google Drive depuis Réglages → Intégrations.";
    } else {
      listError = "Impossible de lister le contenu pour le moment.";
    }
  }

  return (
    <section className={className ?? "space-y-2.5"}>
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h3 className="font-medium text-foreground text-sm">Drive</h3>
          <p className="truncate text-muted-foreground text-xs" title={displayPath ?? ""}>
            {link.folderName}
            {displayPath ? ` · ${displayPath}` : ""}
          </p>
        </div>
        <DriveFolderActions
          subjectType={subjectType}
          subjectId={subjectId}
          folderUrl={link.folderUrl}
          localPath={buildMacOsLocalPath(account.email, localPath)}
        />
      </header>
      {listError ? (
        <p className="text-muted-foreground text-xs italic">{listError}</p>
      ) : (
        <DriveFolderChildrenList files={children} />
      )}
    </section>
  );
}

function Header() {
  return <h3 className="font-medium text-foreground text-sm">Drive</h3>;
}

/**
 * Préfixe le chemin local Drive (relatif au dossier de mount) avec le
 * home macOS Google Drive Desktop. Le `localPath` peut commencer par
 * `My Drive/…` ou `.shortcut-targets-by-id/…` selon le cas.
 */
function buildMacOsLocalPath(email: string, localPath: string | null): string | null {
  if (!localPath) return null;
  return `~/Library/CloudStorage/GoogleDrive-${email}/${localPath}`;
}
