import { formatDate } from "@/lib/format";
import { getGoogleAccount } from "@/lib/google/account";
import { hasRequiredDriveScopes } from "@/lib/google/oauth";

/**
 * Section UI pour connecter / déconnecter le compte Google Drive de
 * l'utilisateur courant. Le bouton "Connecter" est un simple `<a>` vers
 * `/api/google/oauth/start` (qui pose un cookie state puis redirige
 * vers Google). La déconnexion est un POST vers `/api/google/oauth/disconnect`.
 *
 * Si le compte connecté n'a pas tous les scopes requis (typiquement
 * après qu'on a élargi `GOOGLE_DRIVE_SCOPES`), on signale qu'une
 * reconnexion est nécessaire.
 */
export async function GoogleDriveSection({ userId }: { userId: string }) {
  const account = await getGoogleAccount(userId);
  const scopesOk = account ? hasRequiredDriveScopes(account.scopes) : true;

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-sm">Google Drive</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Lier un dossier Drive à chaque projet pour voir son contenu et l'ouvrir d'un clic
            (online et en local via Google Drive Desktop).
          </p>
        </div>
        {!account ? (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Non configuré
          </span>
        ) : scopesOk ? (
          <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-700 text-xs dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            Connecté
          </span>
        ) : (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Reconnexion requise
          </span>
        )}
      </header>

      {account && !scopesOk ? (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">Permissions Drive insuffisantes</p>
          <p className="mt-1">
            Le compte connecté n'a que <code>drive.file</code>, qui ne voit pas les fichiers
            existants d'un dossier sélectionné via Picker. Reconnecte pour ajouter{" "}
            <code>drive.readonly</code> et lister le contenu des dossiers liés.
          </p>
        </div>
      ) : null}

      {account ? (
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="font-medium text-sm">{account.email}</p>
            <p className="text-muted-foreground text-xs">
              Connecté le {formatDate(account.createdAt.toISOString())}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!scopesOk ? (
              <a
                href="/api/google/oauth/start"
                className="rounded-md bg-foreground px-3 py-1.5 text-background text-sm hover:opacity-90"
              >
                Reconnecter
              </a>
            ) : null}
            <form method="POST" action="/api/google/oauth/disconnect">
              <button
                type="submit"
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Déconnecter
              </button>
            </form>
          </div>
        </div>
      ) : (
        <a
          href="/api/google/oauth/start"
          className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-background text-sm hover:opacity-90"
        >
          Connecter Google Drive
        </a>
      )}
    </section>
  );
}
