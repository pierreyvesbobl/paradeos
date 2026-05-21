/**
 * One-shot : pré-pose le dossier Drive racine "Parade" pour l'agent
 * factures. Tu peux aussi le faire depuis /settings/integrations.
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const ROOT_FOLDER_ID = "1TY3DvhCxTClrR1cuQPAqbdI4prS0Wvow";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant");
  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

  await sql`
    insert into public.app_settings (key, value, updated_by)
    values ('INVOICE_FILING_ROOT_FOLDER_ID', ${ROOT_FOLDER_ID}, null)
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
  console.info(`✓ INVOICE_FILING_ROOT_FOLDER_ID = ${ROOT_FOLDER_ID}`);

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
