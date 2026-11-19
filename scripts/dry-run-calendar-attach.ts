/**
 * Essai à blanc du rattachement des rendez-vous du calendrier aux projets,
 * lecture seule (cf. lib/time/calendar-attach.ts).
 *
 * Évalue chaque rendez-vous en cache d'un utilisateur comme la relève le
 * ferait — titre, invités, domaine, réunion Parade OS au même moment — et
 * imprime la décision, les indices et l'éligibilité au temps réalisé, sans
 * rien écrire. À rejouer avant de toucher aux poids de calendar-signals.ts.
 *
 *   NODE_OPTIONS="--import ./scripts/_lib/server-only-shim.mjs" \
 *     pnpm tsx scripts/dry-run-calendar-attach.ts [email du compte Google]
 */

import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const email = process.argv[2];
  const { eq } = await import("drizzle-orm");
  const { googleAccounts } = await import("@/db/schema/google-accounts");
  const { projects } = await import("@/db/schema/projects");
  const { db } = await import("@/lib/db/server");
  const { evaluateCalendarEvents } = await import("@/lib/time/calendar-attach");

  const conn = await db();
  const accounts = await conn
    .select({ userId: googleAccounts.userId, email: googleAccounts.email })
    .from(googleAccounts)
    .where(email ? eq(googleAccounts.email, email) : undefined);
  const names = new Map(
    (await conn.select({ id: projects.id, name: projects.name }).from(projects)).map((p) => [
      p.id,
      p.name,
    ]),
  );

  for (const account of accounts) {
    const evaluations = await evaluateCalendarEvents(conn, account.userId);
    console.info(`\n${account.email} : ${evaluations.length} rendez-vous en cache`);
    let recognized = 0;
    for (const ev of evaluations.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())) {
      const when = ev.startAt.toISOString().slice(0, 16).replace("T", " ");
      const verdict = ev.decision
        ? `→ ${names.get(ev.decision.projectId) ?? ev.decision.projectId} (${ev.decision.reasons.join("+")} ${ev.decision.score})`
        : "— sans projet";
      if (ev.decision) recognized++;
      const flags = [
        ev.ineligible ? `inéligible:${ev.ineligible}` : "éligible",
        ev.ended ? "passé" : "à venir",
        ev.meetingId
          ? `réunion ${ev.meetingId.slice(0, 8)}${ev.meetingNeedsProject ? " (sans projet)" : ""}`
          : null,
      ]
        .filter(Boolean)
        .join(", ");
      console.info(
        `  ${when}  ${(ev.summary ?? "(sans titre)").slice(0, 50).padEnd(50)} ${verdict}  [${flags}]`,
      );
      if (!ev.decision && ev.signals.length > 0) {
        const detail = ev.signals
          .map((s) => `${names.get(s.projectId) ?? s.projectId}:${s.kind}:${s.weight.toFixed(2)}`)
          .join(" ; ");
        console.info(`        indices dispersés : ${detail}`);
      }
    }
    console.info(`  ${recognized}/${evaluations.length} reconnus`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
