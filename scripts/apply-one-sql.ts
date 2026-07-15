import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

async function main() {
  loadEnv({ path: ".env.local" });
  const arg = process.argv[2];
  if (!arg) throw new Error("Usage: tsx scripts/apply-one-sql.ts <path>");
  const file = resolve(process.cwd(), arg);
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant");
  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });
  const content = readFileSync(file, "utf8");
  await sql.unsafe(content);
  await sql.end({ timeout: 5 });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
