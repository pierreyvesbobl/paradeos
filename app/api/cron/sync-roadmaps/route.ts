/**
 * Relit la feuille de route (`roadmap.json`) des dépôts suivis, aligne les
 * tâches liées sur le statut de leur item et propose de nouveaux
 * rapprochements quand quelque chose a bougé (cf. lib/roadmap/sync.ts) ;
 * puis lit les nouveaux commits des dépôts suivis et propose quelle tâche
 * chacun livre (cf. lib/repos/commits-sync.ts).
 *
 * Auth : `Authorization: Bearer <CRON_SECRET>`. Déclenché toutes les
 * quinze minutes par `.github/workflows/crons.yml`, une fois par jour par
 * Vercel en filet de sécurité. Un dépôt inchangé ne coûte qu'un appel
 * GitHub ; le LLM ne tourne que si le fichier ou les tâches ont changé.
 */

import { cronResponse, cronRun, cronUnauthorized } from "@/lib/cron/auth";
import { db } from "@/lib/db/server";
import { syncCommits } from "@/lib/repos/commits-sync";
import { syncRoadmaps } from "@/lib/roadmap/sync";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function run(request: Request): Promise<Response> {
  const unauthorized = cronUnauthorized(request);
  if (unauthorized) return unauthorized;

  const conn = await db();
  const roadmaps = await syncRoadmaps(conn);
  const commits = await syncCommits(conn);
  const errors = [...roadmaps, ...commits].filter((r) => r.status === "error");
  return cronResponse({
    roadmaps: {
      repos: roadmaps.length,
      changedTasks: roadmaps.reduce((n, r) => n + r.changedTasks, 0),
      suggested: roadmaps.reduce((n, r) => n + r.suggested, 0),
      results: roadmaps,
    },
    commits: {
      repos: commits.length,
      added: commits.reduce((n, r) => n + r.added, 0),
      suggested: commits.reduce((n, r) => n + r.suggested, 0),
      results: commits,
    },
    failed: errors.length,
    errors,
  });
}

/** `?detach=1` : répond tout de suite, le travail continue (cf. `cronRun`). */
export function GET(request: Request) {
  return cronRun(request, () => run(request));
}
