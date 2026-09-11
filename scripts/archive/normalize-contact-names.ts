/**
 * Normalise les noms de contacts qui portent la chaîne littérale
 * "null" / "undefined" (résidu d'un `String(x)` sur une valeur
 * manquante, quelque part entre une extraction IA et un import).
 *
 * Les colonnes sont NOT NULL, donc on remet une chaîne vide — que
 * `formatPersonName` traite déjà comme "absent" à l'affichage. Ce
 * script n'est donc pas nécessaire au rendu, il évite juste que la
 * chaîne pollue la recherche et le matching par similarité.
 *
 *   npx tsx scripts/normalize-contact-names.ts          # dry-run
 *   npx tsx scripts/normalize-contact-names.ts --apply
 */
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local" });
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL manquant");
const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

async function main() {
  const apply = process.argv.includes("--apply");
  const targets = await sql`
    select id, first_name, last_name from contacts
    where lower(btrim(last_name)) in ('null','undefined')
       or lower(btrim(first_name)) in ('null','undefined')
  `;
  console.log(`${targets.length} contact(s) avec une chaîne "null"/"undefined" :`);
  for (const r of targets) console.log("   ", JSON.stringify(r));

  if (!apply) {
    console.log("\n(dry-run — relance avec --apply pour normaliser en chaîne vide)");
    await sql.end({ timeout: 5 });
    return;
  }
  // La colonne est NOT NULL : on normalise en chaîne vide, que
  // formatPersonName traite déjà comme "absent".
  const res = await sql`
    update contacts
    set last_name = case when lower(btrim(last_name)) in ('null','undefined') then '' else last_name end,
        first_name = case when lower(btrim(first_name)) in ('null','undefined') then '' else first_name end,
        updated_at = now()
    where lower(btrim(last_name)) in ('null','undefined')
       or lower(btrim(first_name)) in ('null','undefined')
    returning id, first_name, last_name
  `;
  console.log(`\n${res.length} ligne(s) normalisée(s) :`);
  for (const r of res) console.log("   ", JSON.stringify(r));
  await sql.end({ timeout: 5 });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
