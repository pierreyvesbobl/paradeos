/**
 * Applique les fichiers SQL de `supabase/migrations/`, dans l'ordre.
 *
 * Chaque fichier est idempotent pris isolément (DROP IF EXISTS, CREATE OR
 * REPLACE, ADD COLUMN IF NOT EXISTS). En revanche **le dossier n'est plus
 * rejouable depuis zéro** : `0004_opportunities_projects.sql` crée des objets
 * sur `public.opportunities`, que `0020_merge_opportunities_data.sql` supprime
 * ensuite. Rejouer tout sur une base à jour échoue donc sur 0004 avec
 * `relation "public.opportunities" does not exist`.
 *
 * C'est pourquoi ce script prend des arguments : sur une base existante, on
 * n'applique que les migrations nouvelles.
 *
 * Usage :
 *   pnpm db:supabase --from 0073        # 0073 et tous les suivants
 *   pnpm db:supabase 0073 0074 0075     # seulement ces fichiers
 *   pnpm db:supabase --list             # ce qui serait appliqué, sans rien faire
 *   pnpm db:supabase --all              # tout rejouer (échoue après 0020, cf. ci-dessus)
 *
 * `--list` n'ouvre aucune connexion : sûr pour vérifier une sélection avant
 * d'écrire sur la base pointée par `DATABASE_URL` (qui est la production).
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local" });

/** Erreur d'usage : le message suffit, la stack n'apprend rien. */
class UsageError extends Error {}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

/** Masque le mot de passe pour pouvoir afficher la cible sans la divulguer. */
function redactDbUrl(url: string): string {
  return url.replace(/(:\/\/[^:/@]*:)[^@]*@/, "$1***@");
}

type Selection = { files: string[]; mode: string };

/**
 * Résout les arguments en liste de fichiers. Les sélecteurs sont des préfixes
 * (`0073` matche `0073_invoice_brands.sql`) pour qu'on n'ait pas à retaper le
 * nom complet.
 */
function select(all: string[], argv: string[]): Selection {
  const flags = argv.filter((a) => a.startsWith("--"));
  const selectors = argv.filter((a) => !a.startsWith("--"));

  if (flags.includes("--all")) return { files: all, mode: "tout" };

  const fromIdx = argv.indexOf("--from");
  if (fromIdx !== -1) {
    const prefix = argv[fromIdx + 1];
    if (!prefix) throw new UsageError("`--from` attend un préfixe, ex. `--from 0073`.");
    const start = all.findIndex((f) => f.startsWith(prefix));
    if (start === -1) throw new UsageError(`Aucune migration ne commence par « ${prefix} ».`);
    return { files: all.slice(start), mode: `depuis ${all[start]}` };
  }

  if (selectors.length > 0) {
    const files: string[] = [];
    for (const s of selectors) {
      const matches = all.filter((f) => f.startsWith(s));
      if (matches.length === 0) throw new UsageError(`Aucune migration ne commence par « ${s} ».`);
      files.push(...matches);
    }
    // Dédoublonne et garde l'ordre du dossier : l'ordre des arguments ne doit
    // pas pouvoir inverser deux migrations dépendantes.
    const unique = [...new Set(files)];
    return { files: all.filter((f) => unique.includes(f)), mode: "sélection" };
  }

  throw new UsageError(
    "Précise les migrations à appliquer : `--from 0073`, une liste de préfixes, ou `--all`.\n" +
      "Sur une base déjà à jour, `--all` échoue sur 0004 (cf. en-tête du script).",
  );
}

async function main() {
  const dir = resolve(process.cwd(), "supabase/migrations");
  const all = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (all.length === 0) {
    console.info("Aucun fichier SQL dans supabase/migrations.");
    return;
  }

  const argv = process.argv.slice(2);
  const listOnly = argv.includes("--list");
  const { files, mode } = select(
    all,
    argv.filter((a) => a !== "--list"),
  );

  if (listOnly) {
    console.info(`${files.length} fichier(s) seraient appliqués (${mode}) :`);
    for (const f of files) console.info(`  → ${f}`);
    console.info("\nAucune connexion ouverte (--list).");
    return;
  }

  const dbUrl = requireEnv("DATABASE_URL");
  console.info(`Cible : ${redactDbUrl(dbUrl)}`);
  console.info(`Application de ${files.length} fichier(s) SQL (${mode})…`);

  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });
  try {
    for (const file of files) {
      const content = readFileSync(join(dir, file), "utf8");
      console.info(`  → ${file}`);
      await sql.unsafe(content);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  console.info("OK.");
}

main().catch((err) => {
  if (err instanceof UsageError) {
    console.error(err.message);
  } else {
    console.error("Échec :", err);
  }
  process.exit(1);
});
