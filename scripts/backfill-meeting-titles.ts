/**
 * Relit le titre des réunions déjà en base et corrige ce qu'il déclare.
 *
 * Le pipeline Drive recopiait le nom du fichier dans `title` sans le lire.
 * Les réunions ingérées avant `lib/meetings/drive-filename.ts` portent
 * donc leur horodatage dans leur titre et une `occurred_at` fausse (la
 * date d'ingestion, ou celle que le modèle a devinée dans le transcript).
 * Ce script applique la lecture du titre à l'existant :
 *
 *   - `occurred_at` ← la date/heure écrite dans le titre ;
 *   - participants  ← les personnes que le titre nomme, si la réunion
 *     n'en a aucun (purement additif, on ne retire jamais personne).
 *
 * Le titre lui-même n'est pas réécrit : il est affiché partout, et couper
 * l'horodatage d'un titre que quelqu'un a peut-être édité à la main ne
 * vaut pas le risque.
 *
 * Lecture seule par défaut. Pour écrire :
 *
 *   pnpm tsx scripts/backfill-meeting-titles.ts            # dry-run
 *   pnpm tsx scripts/backfill-meeting-titles.ts --commit
 */
import { parseDriveTranscriptName } from "@/lib/meetings/drive-filename";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const COMMIT = process.argv.includes("--commit");

type Row = {
  id: string;
  title: string;
  occurred_at: Date | null;
  participants: number;
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquant.");
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

  try {
    const rows = await sql<Row[]>`
      select m.id,
             m.title,
             m.occurred_at,
             (select count(*)::int from public.meeting_participants p
               where p.meeting_id = m.id) as participants
        from public.meetings m
       order by m.created_at asc`;

    let dateFixed = 0;
    let peopleAdded = 0;
    let untouched = 0;

    for (const row of rows) {
      const parsed = parseDriveTranscriptName(row.title);

      const needsDate =
        parsed.occurredAt !== null &&
        (row.occurred_at === null || row.occurred_at.getTime() !== parsed.occurredAt.getTime());
      // On n'ajoute des participants que si la réunion n'en a aucun :
      // sinon on risque de doubler une personne déjà rattachée sous une
      // autre orthographe, et la fiche vaut mieux que le nom brut.
      const people = row.participants === 0 ? parsed.participants : [];

      if (!needsDate && people.length === 0) {
        untouched++;
        continue;
      }

      const before = row.occurred_at?.toISOString() ?? "—";
      console.info(`« ${row.title} »`);
      if (needsDate && parsed.occurredAt) {
        console.info(`    date : ${before} → ${parsed.occurredAt.toISOString()}`);
        dateFixed++;
      }
      if (people.length > 0) {
        console.info(`    participants : ${people.join(", ")}`);
        peopleAdded += people.length;
      }

      if (!COMMIT) continue;

      if (needsDate && parsed.occurredAt) {
        await sql`
          update public.meetings
             set occurred_at = ${parsed.occurredAt}, updated_at = now()
           where id = ${row.id}`;
      }
      for (const name of people) {
        // `display_name` brut : rattacher à une fiche demande les fuzzy
        // matchers, qui vivent côté serveur Next. La fiche réunion
        // propose le remplacement en un clic.
        await sql`
          insert into public.meeting_participants (meeting_id, display_name, source)
          values (${row.id}, ${name}, 'manual')
          on conflict do nothing`;
      }
    }

    console.info(
      `\n${rows.length} réunion(s) — ${dateFixed} date(s) à corriger, ${peopleAdded} participant(s) à ajouter, ${untouched} inchangée(s).`,
    );
    if (!COMMIT) console.info("Dry-run : rien n'a été écrit. Relance avec --commit.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
