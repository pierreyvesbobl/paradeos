/**
 * Audit des doublons CRM, lecture seule.
 *
 * Passe chaque entité / contact / projet / tâche ouverte dans le matcher
 * anti-doublon (`lib/crm/pick.ts`, le même que les pipelines d'extraction)
 * et liste les paires qu'il rapproche :
 *
 *   - « identique »   : clé normalisée égale (accents, ponctuation, forme
 *     juridique, email). À fusionner — c'est un vrai doublon.
 *   - « ressemblance » : score trigram au-dessus du seuil. À regarder, ce
 *     sont les cas où le matcher proposera « déjà en base ».
 *
 * Le script ne modifie rien : la fusion reste un geste manuel (choisir la
 * fiche à garder, déplacer les liaisons).
 *
 *   pnpm tsx scripts/audit-crm-duplicates.ts
 */
import { MATCH_THRESHOLD, pickBestContact, pickBestMatch } from "@/lib/crm/pick";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

type NamedRow = { id: string; name: string };
type ContactRow = { id: string; firstName: string; lastName: string; email: string | null };

/** Paires rapprochées par le matcher, dédoublonnées (A⇄B = B⇄A). */
function reportNamed(label: string, rows: NamedRow[], threshold: number): void {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const row of rows) {
    const others = rows.filter((o) => o.id !== row.id);
    const match = pickBestMatch(others, row.name, threshold);
    if (!match) continue;
    const key = [row.id, match.id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const verdict = match.confidence >= 1 ? "identique   " : "ressemblance";
    lines.push(`  ${verdict}  ${row.name}  ⇄  ${match.name}  (${match.confidence.toFixed(3)})`);
  }
  console.info(`\n${label} — ${lines.length} paire(s) :`);
  console.info(lines.length > 0 ? lines.join("\n") : "  aucune");
}

function reportContacts(rows: ContactRow[]): void {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const row of rows) {
    const others = rows.filter((o) => o.id !== row.id);
    const match = pickBestContact(others, row);
    if (!match) continue;
    const key = [row.id, match.id].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const verdict = match.confidence >= 1 ? "identique   " : "ressemblance";
    const label = `${row.firstName} ${row.lastName}`.trim();
    lines.push(
      `  ${verdict}  ${label} <${row.email ?? "sans email"}>  ⇄  ${match.name}  (${match.confidence})`,
    );
  }
  console.info(`\nCONTACTS — ${lines.length} paire(s) :`);
  console.info(lines.length > 0 ? lines.join("\n") : "  aucune");
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant.");
  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

  const entities = await sql<NamedRow[]>`select id, name from public.entities`;
  const projects = await sql<NamedRow[]>`select id, name from public.projects`;
  const tasks = await sql<NamedRow[]>`
    select id, title as name from public.tasks where status not in ('done', 'cancelled')
  `;
  const contacts = await sql<ContactRow[]>`
    select id, first_name as "firstName", last_name as "lastName", email from public.contacts
  `;

  reportNamed("ENTITÉS", [...entities], MATCH_THRESHOLD.entity);
  reportContacts([...contacts]);
  // Les projets sont comparés sans scope entité — c'est volontairement plus
  // large que ce que fait l'extraction, pour donner à relire les cas
  // limites (« Formation » vs « Groupe Océa - Formation »).
  reportNamed("PROJETS (sans scope entité)", [...projects], MATCH_THRESHOLD.project);
  reportNamed("TÂCHES OUVERTES", [...tasks], MATCH_THRESHOLD.task);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
