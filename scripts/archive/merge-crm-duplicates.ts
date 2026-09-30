/**
 * Fusion de doublons CRM (entités / contacts).
 *
 * Pour chaque paire garder/supprimer :
 *   1. les champs vides de la fiche gardée sont remplis depuis la fiche
 *      supprimée (rien ne s'écrase, on ne perd pas de donnée saisie) ;
 *   2. toutes les références sont repointées vers la fiche gardée, y
 *      compris les colonnes polymorphes sans FK (`gmail_tags.target_id`,
 *      `*_proposals.matched_id` / `created_entity_id`) — une FK
 *      `on delete set null` effacerait silencieusement la liaison ;
 *   3. les tables à unicité (project_contacts, task_assignees,
 *      meeting_participants, gmail_tags, linkedin_conversation_links)
 *      sont traitées en « déplacer sinon jeter » : si la fiche gardée a
 *      déjà la ligne équivalente, celle du doublon est supprimée ;
 *   4. la fiche en doublon est supprimée.
 *
 * Le tout dans une transaction par paire.
 *
 *   pnpm tsx scripts/archive/merge-crm-duplicates.ts            # dry-run
 *   pnpm tsx scripts/archive/merge-crm-duplicates.ts --apply    # exécute
 *
 * Exécuté le 2026-09-30 sur les quatre paires listées en fin de fichier
 * (repérées avec `scripts/audit-crm-duplicates.ts`) — archivé à ce titre.
 * Le mécanisme reste réutilisable : remplacer `MERGES` par les nouvelles
 * paires. Les fiches supprimées sont sauvegardées dans `backups/` avant
 * toute écriture.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

type Sql = ReturnType<typeof postgres>;

/** Paire à fusionner. `note` documente la décision prise. */
type Merge = {
  table: "entities" | "contacts";
  keepId: string;
  dropId: string;
  note: string;
  /** Champs à forcer sur la fiche gardée (décision humaine). */
  set?: Record<string, string | null>;
};

/**
 * Colonnes pointant vers une fiche, avec le mode de reprise :
 *  - `move`   : simple UPDATE.
 *  - `unique` : UPDATE si la fiche gardée n'a pas déjà l'équivalent
 *    (identifié par les colonnes `scope`), DELETE sinon.
 */
type RefColumn =
  | { table: string; column: string; mode: "move" }
  | { table: string; column: string; mode: "unique"; scope: string[] };

const ENTITY_REFS: RefColumn[] = [
  { table: "contacts", column: "entity_id", mode: "move" },
  { table: "coworking_contracts", column: "bill_to_entity_id", mode: "move" },
  { table: "projects", column: "entity_id", mode: "move" },
  { table: "gmail_tags", column: "target_id", mode: "unique", scope: ["user_id", "kind"] },
  {
    table: "linkedin_conversation_links",
    column: "target_id",
    mode: "unique",
    scope: ["conversation_id", "kind"],
  },
  { table: "email_proposals", column: "matched_id", mode: "move" },
  { table: "email_proposals", column: "created_entity_id", mode: "move" },
  { table: "meeting_proposals", column: "matched_id", mode: "move" },
  { table: "meeting_proposals", column: "created_entity_id", mode: "move" },
  { table: "linkedin_proposals", column: "matched_id", mode: "move" },
  { table: "linkedin_proposals", column: "created_entity_id", mode: "move" },
];

const CONTACT_REFS: RefColumn[] = [
  { table: "coworking_contracts", column: "contact_id", mode: "move" },
  { table: "linkedin_connections", column: "matched_contact_id", mode: "move" },
  { table: "projects", column: "contact_id", mode: "move" },
  { table: "tasks", column: "assignee_contact_id", mode: "move" },
  { table: "time_entries", column: "contact_id", mode: "move" },
  { table: "project_contacts", column: "contact_id", mode: "unique", scope: ["project_id"] },
  { table: "task_assignees", column: "contact_id", mode: "unique", scope: ["task_id", "kind"] },
  {
    table: "meeting_participants",
    column: "contact_id",
    mode: "unique",
    scope: ["meeting_id"],
  },
  { table: "gmail_tags", column: "target_id", mode: "unique", scope: ["user_id", "kind"] },
  {
    table: "linkedin_conversation_links",
    column: "target_id",
    mode: "unique",
    scope: ["conversation_id", "kind"],
  },
  { table: "email_proposals", column: "matched_id", mode: "move" },
  { table: "email_proposals", column: "created_entity_id", mode: "move" },
  { table: "meeting_proposals", column: "matched_id", mode: "move" },
  { table: "meeting_proposals", column: "created_entity_id", mode: "move" },
  { table: "linkedin_proposals", column: "matched_id", mode: "move" },
  { table: "linkedin_proposals", column: "created_entity_id", mode: "move" },
];

/** Champs remplis depuis le doublon quand ils sont vides sur la fiche gardée. */
const FILLABLE: Record<Merge["table"], string[]> = {
  entities: ["website", "siren", "vat_number", "address", "notes", "owner_id"],
  contacts: [
    "email",
    "phone",
    "job_title",
    "linkedin_url",
    "entity_id",
    "qualification",
    "address",
    "notes",
  ],
};

/** `count(*)` d'une requête paramétrée — postgres-js ne type pas `unsafe`. */
async function countRefs(sql: Sql, query: string, params: string[]): Promise<number> {
  const rows = (await sql.unsafe(query, params)) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

/**
 * Sauvegarde des fiches supprimées avant fusion, dans `backups/` (ignoré
 * par git). Une fusion ne se défait pas : sans ça, les notes, téléphones et
 * qualifications récupérés à la main seraient perdus en cas d'erreur.
 */
async function backupDropped(sql: Sql, merges: Merge[]): Promise<string> {
  const dump: Record<string, unknown> = { at: new Date().toISOString(), merges: [] };
  const rows: unknown[] = [];
  for (const merge of merges) {
    const [keep] = await sql.unsafe(`select * from public.${merge.table} where id = $1`, [
      merge.keepId,
    ]);
    const [drop] = await sql.unsafe(`select * from public.${merge.table} where id = $1`, [
      merge.dropId,
    ]);
    rows.push({ table: merge.table, note: merge.note, keep, drop });
  }
  dump.merges = rows;
  mkdirSync("backups", { recursive: true });
  const path = `backups/merge-crm-duplicates-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(path, JSON.stringify(dump, null, 2), "utf8");
  return path;
}

async function mergeOne(sql: Sql, merge: Merge): Promise<void> {
  const refs = merge.table === "entities" ? ENTITY_REFS : CONTACT_REFS;
  const [keep] = await sql.unsafe(`select * from public.${merge.table} where id = $1`, [
    merge.keepId,
  ]);
  const [drop] = await sql.unsafe(`select * from public.${merge.table} where id = $1`, [
    merge.dropId,
  ]);
  if (!keep) throw new Error(`Fiche à garder introuvable : ${merge.keepId}`);
  if (!drop) {
    console.info(`  déjà fusionné (${merge.dropId} absent) — rien à faire`);
    return;
  }

  // 1. Champs vides remplis depuis le doublon, plus les valeurs forcées.
  const patch: Record<string, unknown> = {};
  for (const col of FILLABLE[merge.table]) {
    const current = (keep as Record<string, unknown>)[col];
    const incoming = (drop as Record<string, unknown>)[col];
    const empty = current === null || current === undefined || current === "";
    if (empty && incoming !== null && incoming !== undefined && incoming !== "") {
      patch[col] = incoming;
    }
  }
  Object.assign(patch, merge.set ?? {});
  for (const [col, value] of Object.entries(patch)) {
    console.info(`  ${col} ← ${JSON.stringify(value)}`);
    if (APPLY) {
      await sql.unsafe(`update public.${merge.table} set ${col} = $1 where id = $2`, [
        value as string,
        merge.keepId,
      ]);
    }
  }

  // 2 et 3. Références.
  for (const ref of refs) {
    const n = await countRefs(
      sql,
      `select count(*)::int as n from public.${ref.table} where ${ref.column} = $1`,
      [merge.dropId],
    );
    if (n === 0) continue;

    if (ref.mode === "move") {
      console.info(`  ${ref.table}.${ref.column} : ${n} ligne(s) → fiche gardée`);
      if (APPLY) {
        await sql.unsafe(
          `update public.${ref.table} set ${ref.column} = $1 where ${ref.column} = $2`,
          [merge.keepId, merge.dropId],
        );
      }
      continue;
    }

    // Unicité : on ne déplace que les lignes dont l'équivalent n'existe
    // pas déjà sur la fiche gardée ; le reste est supprimé.
    const scopeMatch = ref.scope.map((c) => `k.${c} is not distinct from d.${c}`).join(" and ");
    const conflictSql = `
      select count(*)::int as n from public.${ref.table} d
      where d.${ref.column} = $2
        and exists (
          select 1 from public.${ref.table} k
          where k.${ref.column} = $1 and ${scopeMatch}
        )`;
    const conflicts = await countRefs(sql, conflictSql, [merge.keepId, merge.dropId]);
    const moved = n - conflicts;
    console.info(
      `  ${ref.table}.${ref.column} : ${moved} déplacée(s), ${conflicts} doublon(s) supprimé(s)`,
    );
    if (APPLY) {
      await sql.unsafe(
        `delete from public.${ref.table} d
         where d.${ref.column} = $2
           and exists (
             select 1 from public.${ref.table} k
             where k.${ref.column} = $1 and ${scopeMatch}
           )`,
        [merge.keepId, merge.dropId],
      );
      await sql.unsafe(
        `update public.${ref.table} set ${ref.column} = $1 where ${ref.column} = $2`,
        [merge.keepId, merge.dropId],
      );
    }
  }

  // 4. Suppression du doublon.
  console.info(`  suppression de ${merge.table}/${merge.dropId}`);
  if (APPLY) {
    await sql.unsafe(`delete from public.${merge.table} where id = $1`, [merge.dropId]);
  }
}

/**
 * Doublons relevés le 2026-09-30 par `scripts/audit-crm-duplicates.ts`.
 * Tous nés le 2026-09-18 d'acceptations de propositions email successives,
 * sauf Amine Slim (saisie manuelle à 4 mois d'écart).
 */
const MERGES: Merge[] = [
  {
    table: "entities",
    keepId: "78a5e8d8-edea-48b1-9a3b-c9f68e1d433a", // MKP Doctor (partner)
    dropId: "7471fc4d-0d8a-44c7-bfbe-d069c370ec46", // mkpdoctor (other)
    note: "MKP Doctor ← mkpdoctor : orthographe et kind=partner corrects sur la fiche gardée.",
  },
  {
    table: "entities",
    keepId: "0ffc6543-c7fa-4809-a2d3-63af33c9bd9a", // Aparisi Consulting (partner)
    dropId: "72f998b5-5c0a-470e-8626-cbb383fcf6cc", // a paris consulting (other)
    note: "Aparisi Consulting ← a paris consulting : la seconde est une transcription phonétique.",
  },
  {
    table: "contacts",
    keepId: "88b9ba50-ee4d-445c-a55f-e87386adeacd", // Amine Slim, mai 2026, lié au projet AtScale
    dropId: "d49d6b03-7aff-46cd-a0e2-9ffea8295fae", // Amine Slim, septembre 2026, téléphone + notes
    note: "Amine Slim : on garde la fiche liée au projet AtScale et on récupère téléphone, qualification et notes de la seconde.",
  },
  {
    table: "contacts",
    keepId: "758bc35e-8f0e-45e1-9ea5-46ec739ec3c9", // julien@cephalopode.com, Céphalopode, Lead développeur
    dropId: "86d34aff-5349-4ab9-80c1-457dd97c2d4f", // julien.lacoentre@nextase.fr, lié au projet GpasPlus
    note: "Julien Laco(ë)ntre : une seule personne, deux adresses actives le même jour. On garde la fiche Céphalopode et on lui rattache le projet GpasPlus.",
    set: {
      // Le champ `email` est unique par fiche : la seconde adresse, bien
      // vivante, est consignée dans les notes pour ne pas la perdre.
      notes: "Autre adresse utilisée : julien.lacoentre@nextase.fr (Nextase).",
    },
  },
];

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant.");
  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

  console.info(
    APPLY ? "Mode APPLY — les données sont modifiées.\n" : "Dry-run (--apply pour exécuter).\n",
  );

  if (APPLY) {
    console.info(`Sauvegarde des fiches concernées : ${await backupDropped(sql, MERGES)}`);
  }

  for (const merge of MERGES) {
    console.info(`\n${merge.note}`);
    if (APPLY) {
      await sql.begin(async (tx) => {
        await mergeOne(tx as unknown as Sql, merge);
      });
    } else {
      await mergeOne(sql, merge);
    }
  }

  await sql.end();
  console.info(APPLY ? "\nFusion terminée." : "\nRien n'a été modifié.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
