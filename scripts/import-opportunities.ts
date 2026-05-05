/**
 * Import phase 2 — opportunités Automato extraites de Notion.
 *
 * Curated subset (15 opportunités principales, mappées sur les statuts
 * Notion). Idempotent : doublon détecté par titre.
 *
 * Crée à la volée les entités manquantes (kind=prospect par défaut) ;
 * lie aux contacts existants quand le rattachement est explicite.
 *
 * Usage : pnpm import:opportunities
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { eq, ilike } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { contacts as contactsTable } from "../db/schema/contacts";
import { entities as entitiesTable } from "../db/schema/entities";
import { opportunities as opportunitiesTable } from "../db/schema/opportunities";
import { users as usersTable } from "../db/schema/users";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

type Status = "not_started" | "to_follow_up" | "awaiting_response" | "won" | "lost";

type OpportunitySeed = {
  title: string;
  status: Status;
  entityName?: string;
  contactFullName?: string;
  source?: string;
  firstContactDate?: string;
  lastContactDate?: string;
  followUpDate?: string;
  notes?: string;
};

const OPPORTUNITIES: OpportunitySeed[] = [
  {
    title: "Thermigo",
    status: "won",
    entityName: "Thermigo",
    contactFullName: "Cécile Emery",
    lastContactDate: "2026-04-24",
    notes: "Mission signée. Cf. tâches Notion.",
  },
  {
    title: "D&G Voyage — Automatisation",
    status: "to_follow_up",
    entityName: "D&G Voyage",
    contactFullName: "D&G Voyage",
    firstContactDate: "2026-04-27",
    lastContactDate: "2026-04-27",
    followUpDate: "2026-05-05",
    source: "Cal.com — Appel découverte Automato",
    notes:
      "Agence de voyage — besoins en automatisation à qualifier. Appel découverte du 27/04/2026.",
  },
  {
    title: "Antia",
    status: "to_follow_up",
    entityName: "Antia EPI",
    contactFullName: "Nabila Monnet",
  },
  {
    title: "Junik (tatoueur) — Site web + RDV intelligent",
    status: "awaiting_response",
    entityName: "Junik",
    contactFullName: "Junik —",
  },
  {
    title: "Radio Paname Grandes Musiques",
    status: "to_follow_up",
    entityName: "GROUPEdeRADiOS",
    contactFullName: "Emmanuel Rials",
  },
  {
    title: "Socialdesk x Automato — Partenariat & intégration MCP",
    status: "awaiting_response",
    entityName: "Socialdesk",
    contactFullName: "Benjamin —",
    notes: "Partenariat ou intégration MCP. Réunion 28/04/2026.",
  },
  {
    title: "Avenir Focus",
    status: "to_follow_up",
    entityName: "Avenir Focus",
    contactFullName: "Lambert Vincent",
  },
  {
    title: "Cadeaux Privés",
    status: "lost",
    entityName: "Cadeaux Privés",
    contactFullName: "Sébastien Argoud",
  },
  {
    title: "Tech Valley",
    status: "to_follow_up",
    entityName: "Tech Valley",
    contactFullName: "Sébastien Garcia",
  },
  {
    title: "AtScale",
    status: "lost",
    entityName: "AtScale",
    contactFullName: "Amine Slim",
  },
  {
    title: "Alunites",
    status: "to_follow_up",
    entityName: "Alunites",
  },
  {
    title: "Inox Tag — Automatisation post-production vidéo",
    status: "awaiting_response",
    entityName: "Inox Tag",
  },
  {
    title: "VidCuz — Outil analyse rétention YouTube",
    status: "not_started",
    entityName: "VidCuz",
  },
  {
    title: "Renault (via Alexandre Jass) — Automatisation vidéo",
    status: "not_started",
    entityName: "Renault",
    contactFullName: "Alexandre —",
  },
  {
    title: "AV1 — SaaS études de marché",
    status: "not_started",
    entityName: "AV1",
  },
];

const DEFAULT_PROBABILITY: Record<Status, number> = {
  not_started: 10,
  to_follow_up: 40,
  awaiting_response: 60,
  won: 100,
  lost: 0,
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

async function main() {
  const dbUrl = requireEnv("DATABASE_URL");
  const sqlClient = postgres(dbUrl, { prepare: false, max: 2 });
  const db = drizzle(sqlClient);

  const [admin] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"))
    .limit(1);

  if (!admin) throw new Error("Aucun user admin. Lance `pnpm seed`.");

  console.info(`Import : ${OPPORTUNITIES.length} opportunités.`);

  for (const seed of OPPORTUNITIES) {
    // Doublon par titre (case-insensitive).
    const [existing] = await db
      .select({ id: opportunitiesTable.id })
      .from(opportunitiesTable)
      .where(ilike(opportunitiesTable.title, seed.title))
      .limit(1);

    if (existing) {
      console.info(`  · existe : ${seed.title}`);
      continue;
    }

    // Entité : trouve ou crée.
    let entityId: string | null = null;
    if (seed.entityName) {
      const [entity] = await db
        .select({ id: entitiesTable.id })
        .from(entitiesTable)
        .where(ilike(entitiesTable.name, seed.entityName))
        .limit(1);

      if (entity) {
        entityId = entity.id;
      } else {
        const [created] = await db
          .insert(entitiesTable)
          .values({
            name: seed.entityName,
            kind: "prospect",
            ownerId: admin.id,
            createdBy: admin.id,
          })
          .returning({ id: entitiesTable.id });
        entityId = created?.id ?? null;
        if (entityId) console.info(`    + entité auto-créée : ${seed.entityName}`);
      }
    }

    // Contact : trouve par nom si fourni.
    let contactId: string | null = null;
    if (seed.contactFullName) {
      const parts = seed.contactFullName.trim().split(/\s+/);
      const firstName = parts[0] ?? "";
      const lastName = parts.slice(1).join(" ") || "—";
      const [contact] = await db
        .select({ id: contactsTable.id })
        .from(contactsTable)
        .where(ilike(contactsTable.firstName, firstName) && ilike(contactsTable.lastName, lastName))
        .limit(1);
      contactId = contact?.id ?? null;
    }

    await db.insert(opportunitiesTable).values({
      title: seed.title,
      status: seed.status,
      entityId,
      contactId,
      probability: DEFAULT_PROBABILITY[seed.status],
      source: seed.source ?? null,
      firstContactDate: seed.firstContactDate ?? null,
      lastContactDate: seed.lastContactDate ?? null,
      followUpDate: seed.followUpDate ?? null,
      notes: seed.notes ?? null,
      ownerId: admin.id,
      createdBy: admin.id,
    });

    console.info(`  ✓ ${seed.title} (${seed.status})`);
  }

  await sqlClient.end({ timeout: 5 });
  console.info("Import terminé.");
}

main().catch((err) => {
  console.error("Import échoué :", err);
  process.exit(1);
});
