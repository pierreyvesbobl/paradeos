/**
 * Essai à blanc de l'extraction d'une réunion, lecture seule.
 *
 * Lit le transcript, le contexte projet et les participants comme le
 * pipeline réel, appelle le LLM, et imprime ce qu'il renvoie — tâches
 * proposées avec leurs passages, tâches connues réévoquées, clôtures —
 * sans rien écrire : ni propositions, ni sources, ni résumé. Sert à juger
 * un prompt sur un vrai transcript avant de déployer.
 *
 *   NODE_OPTIONS="--import ./scripts/_lib/server-only-shim.mjs" \
 *     pnpm tsx scripts/dry-run-meeting-extraction.ts <meetingId>
 */

import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const meetingId = process.argv[2];
  if (!meetingId) throw new Error("usage : dry-run-meeting-extraction.ts <meetingId>");

  // Imports après le chargement de .env.local : `db()` lit DATABASE_URL à l'import.
  const { eq } = await import("drizzle-orm");
  const { meetings } = await import("@/db/schema/meetings");
  const { db } = await import("@/lib/db/server");
  const { extractMeeting } = await import("@/lib/meetings/extract");
  const { getParticipantContext } = await import("@/lib/meetings/participants");
  const { loadProjectContext } = await import("@/lib/meetings/extract-and-save");

  const conn = await db();
  const [meeting] = await conn.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  if (!meeting?.transcript) throw new Error("Réunion introuvable ou sans transcript.");

  const started = Date.now();
  const result = await extractMeeting(meeting.transcript, {
    projectContext: await loadProjectContext(meeting.projectId),
    participants: await getParticipantContext(meeting.id),
    meetingContext: { title: meeting.title, occurredAt: meeting.occurredAt },
    priorityProjectId: meeting.projectId,
  });
  const seconds = Math.round((Date.now() - started) / 1000);

  const out: string[] = [];
  out.push(
    `# ${meeting.title} (${meeting.transcript.length} caractères, extraction en ${seconds} s)`,
  );
  out.push("", `## Tâches proposées (${result.proposedTasks.length})`);
  for (const t of result.proposedTasks) {
    out.push("", `- **${t.title}**${t.assigneeName ? ` — ${t.assigneeName}` : ""}`);
    for (const e of t.excerpts) out.push(`  > ${e.speaker ? `${e.speaker} : ` : ""}« ${e.quote} »`);
    if (t.excerpts.length === 0) out.push("  (aucun passage)");
  }
  out.push("", `## Tâches connues réévoquées (${result.mentionedTasks.length})`);
  for (const m of result.mentionedTasks) {
    out.push("", `- **${m.taskTitle}**`);
    for (const e of m.excerpts) out.push(`  > ${e.speaker ? `${e.speaker} : ` : ""}« ${e.quote} »`);
  }
  out.push("", `## Tâches données pour faites (${result.completedTasks.length})`);
  for (const c of result.completedTasks) {
    out.push(`- **${c.taskTitle}** (${c.confidence}) : « ${c.evidence} »`);
  }
  process.stdout.write(`${out.join("\n")}\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
