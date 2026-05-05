/**
 * Import phase 1 — entités + contacts extraits du Notion Automato.
 *
 * Idempotent : on cherche par nom (entités) ou par e-mail / nom complet
 * (contacts). Pas de mise à jour pour ne pas écraser les saisies
 * manuelles ; les doublons sont ignorés.
 *
 * Usage : pnpm import:automato
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { and, eq, ilike } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { contacts as contactsTable } from "../db/schema/contacts";
import { entities as entitiesTable } from "../db/schema/entities";
import { users as usersTable } from "../db/schema/users";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const ADMIN_EMAIL = "pierreyves@bobl.fr";

type EntitySeed = {
  name: string;
  kind: "client" | "prospect" | "partner" | "supplier" | "other";
  website?: string;
};

type ContactSeed = {
  firstName: string;
  lastName: string;
  email?: string;
  entityName?: string;
};

const ENTITIES: EntitySeed[] = [
  { name: "Antia EPI", kind: "prospect" },
  { name: "D&G Voyage", kind: "prospect" },
  { name: "GROUPEdeRADiOS", kind: "prospect" },
  { name: "CAD.42", kind: "client" },
  { name: "Thermigo", kind: "client" },
  { name: "Socialdesk", kind: "partner" },
];

const CONTACTS: ContactSeed[] = [
  { firstName: "Nabila", lastName: "Monnet", entityName: "Antia EPI" },
  {
    firstName: "D&G",
    lastName: "Voyage",
    email: "dgvcontacts@gmail.com",
    entityName: "D&G Voyage",
  },
  {
    firstName: "Emmanuel",
    lastName: "Rials",
    email: "er@groupederadios.fr",
    entityName: "GROUPEdeRADiOS",
  },
  { firstName: "Alexandre", lastName: "—" },
  { firstName: "Vivien", lastName: "Garnès", email: "vivien.garnes@gmail.com" },
  { firstName: "Junik", lastName: "—" },
  { firstName: "Stéphanie", lastName: "—" },
  {
    firstName: "Rafa",
    lastName: "Garcia",
    email: "rgarciabrotons@cad42.com",
    entityName: "CAD.42",
  },
  {
    firstName: "Cécile",
    lastName: "Emery",
    email: "cecile@thermigo.com",
    entityName: "Thermigo",
  },
  {
    firstName: "Badr",
    lastName: "Bouslikhin",
    email: "badr@thermigo.com",
    entityName: "Thermigo",
  },
  { firstName: "Sébastien", lastName: "Argoud" },
  { firstName: "Sébastien", lastName: "Garcia" },
  { firstName: "Amine", lastName: "Slim" },
  {
    firstName: "Paul",
    lastName: "—",
    email: "paul@thermigo.com",
    entityName: "Thermigo",
  },
  { firstName: "Pierre", lastName: "Houé" },
  { firstName: "Lambert", lastName: "Vincent" },
  { firstName: "Oram", lastName: "Dannreuther" },
  {
    firstName: "Benjamin",
    lastName: "—",
    email: "benjamin@socialdesk.fr",
    entityName: "Socialdesk",
  },
  { firstName: "Yanis", lastName: "Bouazzaoui" },
  { firstName: "Luc", lastName: "de Magneval" },
  { firstName: "Maxence", lastName: "Gully" },
  { firstName: "Maël", lastName: "André" },
  { firstName: "Jean", lastName: "Isnard" },
  { firstName: "Yann", lastName: "Lemoine" },
];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

async function main() {
  const dbUrl = requireEnv("DATABASE_URL");
  const sqlClient = postgres(dbUrl, { prepare: false, max: 2 });
  const db = drizzle(sqlClient);

  // Récupère le user admin pour ownerId / createdBy.
  const [admin] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"))
    .limit(1);

  if (!admin) {
    throw new Error("Aucun user admin en base. Lance `pnpm seed` d'abord.");
  }

  console.info(`Import : ${ENTITIES.length} entités, ${CONTACTS.length} contacts.`);
  console.info(`Owner par défaut : ${ADMIN_EMAIL} (${admin.id})`);

  const entityIdByName = new Map<string, string>();

  // 1) Entités.
  for (const seed of ENTITIES) {
    const [existing] = await db
      .select({ id: entitiesTable.id })
      .from(entitiesTable)
      .where(ilike(entitiesTable.name, seed.name))
      .limit(1);

    if (existing) {
      entityIdByName.set(seed.name, existing.id);
      console.info(`  · entité existe : ${seed.name}`);
      continue;
    }

    const [inserted] = await db
      .insert(entitiesTable)
      .values({
        name: seed.name,
        kind: seed.kind,
        website: seed.website ?? null,
        ownerId: admin.id,
        createdBy: admin.id,
      })
      .returning({ id: entitiesTable.id });

    if (inserted) {
      entityIdByName.set(seed.name, inserted.id);
      console.info(`  ✓ entité créée : ${seed.name}`);
    }
  }

  // 2) Contacts.
  for (const seed of CONTACTS) {
    // Doublon ?
    const conditions = [
      and(
        ilike(contactsTable.firstName, seed.firstName),
        ilike(contactsTable.lastName, seed.lastName),
      ),
    ];
    if (seed.email) conditions.push(eq(contactsTable.email, seed.email));

    const [existing] = await db
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(conditions[0])
      .limit(1);

    if (existing) {
      console.info(`  · contact existe : ${seed.firstName} ${seed.lastName}`);
      continue;
    }

    const entityId = seed.entityName ? entityIdByName.get(seed.entityName) : undefined;

    await db.insert(contactsTable).values({
      firstName: seed.firstName,
      lastName: seed.lastName,
      email: seed.email ?? null,
      entityId: entityId ?? null,
      ownerId: admin.id,
      createdBy: admin.id,
    });

    console.info(
      `  ✓ contact créé : ${seed.firstName} ${seed.lastName}${entityId ? ` → ${seed.entityName}` : ""}`,
    );
  }

  await sqlClient.end({ timeout: 5 });
  console.info("Import terminé.");
}

main().catch((err) => {
  console.error("Import échoué :", err);
  process.exit(1);
});
