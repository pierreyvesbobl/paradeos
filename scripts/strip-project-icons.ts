/**
 * One-shot : vide la colonne `icon` de tous les projets pour retirer
 * les emojis affichés à côté du nom dans l'UI.
 *
 * Usage : pnpm tsx scripts/strip-project-icons.ts
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { projects } from "../db/schema/projects";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant");
  const sqlClient = postgres(dbUrl, { prepare: false, max: 1 });
  const db = drizzle(sqlClient);

  const result = await db
    .update(projects)
    .set({ icon: null })
    .where(isNotNull(projects.icon))
    .returning({ id: projects.id, name: projects.name });

  console.info(`Icônes retirées sur ${result.length} projet(s).`);
  await sqlClient.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
