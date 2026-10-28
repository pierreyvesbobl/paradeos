import { and, eq, sql } from "drizzle-orm";
import { taskCommitLinks } from "@/db/schema/repo-commits";
import { taskRoadmapLinks } from "@/db/schema/repo-roadmaps";
import { db } from "@/lib/db/server";
import { AUTO_CONFIRM_CHOICES, getAutoConfirmMin } from "@/lib/dev/auto-confirm";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { DevAutoConfirmForm } from "./dev-auto-confirm-form";

/**
 * Rapprochements dev (feuille de route, commits) confirmés sans clic
 * au-dessus d'un seuil de confiance, avec les compteurs de ce que la
 * synchro a confirmé seule.
 */
export async function DevAutoConfirmSection() {
  const conn = await db();
  const [raw, min, roadmapAuto, commitAuto, pending] = await Promise.all([
    getSetting(SETTING_KEYS.DEV_AUTO_CONFIRM_MIN),
    getAutoConfirmMin(),
    conn
      .select({ n: sql<number>`count(*)::int` })
      .from(taskRoadmapLinks)
      .where(and(eq(taskRoadmapLinks.status, "confirmed"), eq(taskRoadmapLinks.auto, true))),
    conn
      .select({ n: sql<number>`count(*)::int` })
      .from(taskCommitLinks)
      .where(and(eq(taskCommitLinks.status, "confirmed"), eq(taskCommitLinks.auto, true))),
    Promise.all([
      conn
        .select({ n: sql<number>`count(*)::int` })
        .from(taskRoadmapLinks)
        .where(eq(taskRoadmapLinks.status, "suggested")),
      conn
        .select({ n: sql<number>`count(*)::int` })
        .from(taskCommitLinks)
        .where(eq(taskCommitLinks.status, "suggested")),
    ]),
  ]);
  const value = AUTO_CONFIRM_CHOICES.some((c) => c.value === raw)
    ? (raw as string)
    : min === null
      ? "off"
      : String(min);
  const toValidate = (pending[0][0]?.n ?? 0) + (pending[1][0]?.n ?? 0);

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-sm">Rapprochements dev sans clic</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            La synchro propose quelle tâche chaque item de feuille de route et chaque commit
            réalise. Au-dessus du seuil, elle confirme seule : la tâche suit l'item, ou passe en
            terminée pour un commit. Le lien reste visible avec la mention « auto » dans l'onglet
            Développement, et se retire d'un clic.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${min !== null ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}
        >
          {min !== null ? `Automatique dès ${Math.round(min * 100)} %` : "Sur validation"}
        </span>
      </header>

      <div className="mb-3 grid grid-cols-3 gap-3">
        <Stat label="À valider" value={String(toValidate)} />
        <Stat label="Items confirmés auto" value={String(roadmapAuto[0]?.n ?? 0)} />
        <Stat label="Commits confirmés auto" value={String(commitAuto[0]?.n ?? 0)} />
      </div>

      <DevAutoConfirmForm value={value} choices={AUTO_CONFIRM_CHOICES} />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-background p-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="mt-0.5 font-semibold text-sm tabular-nums">{value}</p>
    </div>
  );
}
