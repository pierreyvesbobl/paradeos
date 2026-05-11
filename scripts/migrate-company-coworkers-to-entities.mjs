/**
 * Migrate les coworkers qui sont en réalité des sociétés (Webedia,
 * Boots & Cats SARL…) vers des entités. Lie les contrats coworking
 * correspondants via `bill_to_entity_id`.
 *
 * Idempotent : ne crée pas de doublons. Identifie les "sociétés" par
 * heuristique : contact dont le firstName ressemble à un nom de société
 * (Webedia, Boots & Cats) ou dont le lastName est "SARL"/"SAS"/etc.
 *
 * Usage : node scripts/migrate-company-coworkers-to-entities.mjs
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: "/Users/pierre-yvessage/Dev/paradeos/.env.local", quiet: true });
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL manquante");

const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

/** Mapping contact (firstName lastName) → entity (name, kind) à créer. */
const TARGETS = [
  { firstName: "Webedia", lastName: "—", entityName: "Webedia", kind: "client" },
  { firstName: "Boots & Cats", lastName: "SARL", entityName: "Boots & Cats SARL", kind: "client" },
];

async function main() {
  for (const t of TARGETS) {
    // 1. Trouve le contact "société".
    const [contact] = await sql`
      select id, entity_id from public.contacts
      where first_name = ${t.firstName} and last_name = ${t.lastName}
      limit 1
    `;
    if (!contact) {
      console.warn(`  ⚠ contact introuvable : ${t.firstName} ${t.lastName} — skip`);
      continue;
    }

    // 2. Trouve ou crée l'entité.
    let entityId = contact.entity_id;
    if (!entityId) {
      const [existingEntity] = await sql`
        select id from public.entities where lower(name) = ${t.entityName.toLowerCase()} limit 1
      `;
      if (existingEntity) {
        entityId = existingEntity.id;
        console.log(`  entité existante : ${t.entityName} → ${entityId}`);
      } else {
        const [row] = await sql`
          insert into public.entities (name, kind)
          values (${t.entityName}, ${t.kind})
          returning id
        `;
        entityId = row.id;
        console.log(`  entité créée    : ${t.entityName} → ${entityId}`);
      }
      // Linke le contact à l'entité.
      await sql`update public.contacts set entity_id = ${entityId} where id = ${contact.id}`;
    } else {
      console.log(`  contact ${t.firstName} déjà linké à entité ${entityId}`);
    }

    // 3. Update les contrats coworking de ce contact pour pointer
    //    `bill_to_entity_id` vers l'entité (si pas déjà).
    const updated = await sql`
      update public.coworking_contracts
      set bill_to_entity_id = ${entityId}
      where contact_id = ${contact.id} and bill_to_entity_id is null
      returning id, name
    `;
    for (const c of updated) {
      console.log(`    contrat ${c.name} → bill_to_entity_id = ${entityId}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("Échec :", err);
    process.exitCode = 1;
  })
  .finally(() => sql.end({ timeout: 5 }));
