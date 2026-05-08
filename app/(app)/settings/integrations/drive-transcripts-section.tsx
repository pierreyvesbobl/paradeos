import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { DriveTranscriptsForm } from "./drive-transcripts-form";

/**
 * Section UI pour configurer le watch d'un dossier Drive contenant les
 * transcripts de meetings. Le cron `ingest-drive-transcripts` (30 min)
 * et le bouton « Sync now » ingèrent les nouveaux fichiers et lancent
 * l'extraction LLM.
 */
export async function DriveTranscriptsSection() {
  const folderId = await getSetting(SETTING_KEYS.MEETINGS_DRIVE_FOLDER_ID);
  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-sm">Transcripts Drive (auto-import)</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Surveille un dossier Google Drive et crée un meeting pour chaque nouveau fichier (Google
            Doc ou texte). L'extraction LLM (résumé, projet/contacts/date suggérés) est lancée
            automatiquement. Cron toutes les 30 min — sync manuel disponible.
          </p>
        </div>
        {folderId ? (
          <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-700 text-xs dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            Surveillé
          </span>
        ) : (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Non configuré
          </span>
        )}
      </header>
      <DriveTranscriptsForm currentFolderId={folderId} />
    </section>
  );
}
