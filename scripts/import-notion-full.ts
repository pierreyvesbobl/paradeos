/**
 * Import Notion complet — opportunités + projets, statuts à jour.
 *
 * Comportement :
 *  - Opportunités : upsert par titre (case-insensitive). Si le statut Notion
 *    a changé, on met à jour `status` + `probability`. Le reste reste tel
 *    quel pour ne pas écraser des saisies manuelles.
 *  - Projets : upsert par nom. Statut + kind synchronisés depuis Notion.
 *  - Entités : créées à la volée si elles n'existent pas (kind=prospect par
 *    défaut, ou client si rattachées à un projet).
 *
 * Usage : pnpm import:notion-full
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { eq, ilike } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { entities as entitiesTable } from "../db/schema/entities";
import { opportunities as opportunitiesTable } from "../db/schema/opportunities";
import { projects as projectsTable } from "../db/schema/projects";
import { users as usersTable } from "../db/schema/users";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

type OppStatus =
  | "not_started"
  | "proposal_sent"
  | "to_follow_up"
  | "awaiting_response"
  | "won"
  | "lost";

type ProjectKind = "client" | "product" | "transverse";
type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "archived";

type OpportunitySeed = {
  title: string;
  status: OppStatus;
  entityName?: string;
  contactFullName?: string;
  source?: string;
  notes?: string;
};

type ProjectSeed = {
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  entityName?: string;
  description?: string;
  icon?: string;
  color?: string;
};

const DEFAULT_PROBABILITY: Record<OppStatus, number> = {
  not_started: 10,
  proposal_sent: 50,
  to_follow_up: 40,
  awaiting_response: 60,
  won: 100,
  lost: 0,
};

// ---------------------------------------------------------------------------
// OPPORTUNITÉS — extraites du Notion data source
// (collection://2335d5cd-375f-804c-93bd-000b46395664).
// Statuts mappés depuis "Status Prise De Contact" :
//   "Not started" → not_started, "Proposition en cours" → proposal_sent,
//   "à relancer" → to_follow_up, "En attente de réponse" → awaiting_response,
//   "Signé" → won, "Abandon" → lost.
// ---------------------------------------------------------------------------
const OPPORTUNITIES: OpportunitySeed[] = [
  // Signées / actives
  { title: "Thermigo", status: "won", entityName: "Thermigo", contactFullName: "Cécile Emery" },
  { title: "PrevandCare", status: "won", entityName: "PrevandCare" },
  { title: "CAD.42", status: "won", entityName: "CAD.42", contactFullName: "Rafa Garcia" },

  // En cours commercial
  {
    title: "D&G Voyage — Automatisation",
    status: "to_follow_up",
    entityName: "D&G Voyage",
    contactFullName: "D&G Voyage",
    source: "Cal.com — Appel découverte",
    notes: "Agence de voyage — besoins en automatisation à qualifier.",
  },
  {
    title: "Antia",
    status: "to_follow_up",
    entityName: "Antia EPI",
    contactFullName: "Nabila Monnet",
  },
  {
    title: "Junik (tatoueur) — Site web + RDV intelligent",
    status: "proposal_sent",
    entityName: "Junik",
  },
  {
    title: "Junik — Site web tatoueur",
    status: "proposal_sent",
    entityName: "Junik",
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
  },
  {
    title: "Avenir Focus",
    status: "to_follow_up",
    entityName: "Avenir Focus",
    contactFullName: "Lambert Vincent",
  },
  {
    title: "Tech Valley",
    status: "to_follow_up",
    entityName: "Tech Valley",
    contactFullName: "Sébastien Garcia",
  },
  { title: "Alunites", status: "to_follow_up", entityName: "Alunites" },
  {
    title: "Inox Tag — Automatisation post-production vidéo",
    status: "proposal_sent",
    entityName: "Inox Tag",
  },
  {
    title: "Walibi — automatisation / IA",
    status: "to_follow_up",
    entityName: "Walibi",
  },
  {
    title: "Stéphanie - Scalezia",
    status: "to_follow_up",
    entityName: "Scalezia",
  },
  {
    title: "Homer (Quentin)",
    status: "to_follow_up",
    entityName: "Homer",
  },
  {
    title: "Experis",
    status: "to_follow_up",
    entityName: "Experis",
  },

  // Découverte / pas démarré
  {
    title: "VidCuz — Outil analyse rétention YouTube",
    status: "not_started",
    entityName: "VidCuz",
  },
  {
    title: "Renault — Automatisation vidéo (via Alexandre)",
    status: "not_started",
    entityName: "Renault",
    contactFullName: "Alexandre —",
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

  // Abandonnées
  {
    title: "Cadeaux Privés",
    status: "lost",
    entityName: "Cadeaux Privés",
    contactFullName: "Sébastien Argoud",
  },
  {
    title: "AtScale",
    status: "lost",
    entityName: "AtScale",
    contactFullName: "Amine Slim",
  },
];

// ---------------------------------------------------------------------------
// PROJETS — extraits du Notion data source
// (collection://0a2d3463-1f86-44fb-9cf6-c81500ab0e1b).
// Statuts mappés :
//   "💡 Opportunité"  → planning
//   "🌱 Exploration"  → planning
//   "🚀 En cours"     → active
//   "⏸ En pause"     → on_hold
//   "✅ Terminé"     → completed
//   "🔴 Abandonné"   → archived
// ---------------------------------------------------------------------------
const PROJECTS: ProjectSeed[] = [
  // Missions clients (kind=client)
  {
    name: "Thermigo — Site web",
    kind: "client",
    status: "active",
    entityName: "Thermigo",
    description:
      "Site web Thermigo — 2 000€ signé. Approche agile vibe codé avec Claude. Prochaine proposition 5-10 k€.",
  },
  {
    name: "PrevandCare Site",
    kind: "client",
    status: "active",
    entityName: "PrevandCare",
    description:
      "Refonte site web. Repositionnement assistant fragilité sociale (aidance + parentalité + santé mentale). NPS 95, ROI 3x.",
  },
  {
    name: "CAD.42 — Automatisation gestion stock",
    kind: "client",
    status: "active",
    entityName: "CAD.42",
    description:
      "Pipeline lecture auto factures fournisseurs → base inventaire Notion. 1 500€. V1 terminée, tests client en cours.",
  },
  {
    name: "AV1 — SaaS études de marché",
    kind: "client",
    status: "planning",
    entityName: "AV1",
    description:
      "MVP SaaS d'études de marché avec gestion d'utilisateurs, interviews et système de panels. Budget 15 000 € phase 1.",
  },
  {
    name: "VidCuz — Outil analyse rétention YouTube",
    kind: "client",
    status: "planning",
    entityName: "VidCuz",
    description:
      "Outil SaaS d'analyse des courbes de rétention YouTube. Client Facebook Cuisine. Cible 500-1000 €/mois.",
  },

  // Produits internes (kind=product)
  {
    name: "Prospere",
    kind: "product",
    status: "active",
    color: "#4F46E5",
    description: "Outil IA de prospection. Déploiement en cours sur tous les postes de l'équipe.",
  },
  {
    name: "Placement",
    kind: "product",
    status: "active",
    color: "#7C3AED",
    description:
      "SaaS YouTube sponsoring. BDD 40k chaînes + sponsors. Weekly reports auto. MCP dédié.",
  },
  {
    name: "Galac",
    kind: "product",
    status: "active",
    color: "#0EA5E9",
    description:
      "CMS sites de contenu auto, alimentés par contenus Facebook performants. Migration Clickbait.",
  },
  {
    name: "Clickbait",
    kind: "product",
    status: "active",
    color: "#F59E0B",
    description: "Outil interne (remplacement Nonli) — récup posts Facebook + republication.",
  },
  {
    name: "Ouili",
    kind: "product",
    status: "active",
    color: "#3B82F6",
    description: "Automatisation posts Facebook via social listening sur Peakni. Pages monétisées.",
  },
  {
    name: "Remorph.It",
    kind: "product",
    status: "active",
    color: "#10B981",
    description:
      "Extension Chrome — scan contenus social media, transcrit vidéos, génère via templates.",
  },
  {
    name: "Autoradio",
    kind: "product",
    status: "active",
    color: "#EF4444",
    description:
      "Outil de radio automation. Connexion Wix. Articles + posts auto. Refonte scalable (GROUPEdeRADiOS).",
  },
  {
    name: "Offre Mascotte",
    kind: "product",
    status: "active",
    color: "#EC4899",
    description:
      "Offre B2B 'donner vie à votre personnage' — parcs de loisirs, campings, jouets, éditeurs.",
  },
  {
    name: "Série animée",
    kind: "product",
    status: "active",
    color: "#8B5CF6",
    description: "Série animée Parade. Épisodes 1 & 2 prêts à distribuer.",
  },
  {
    name: "Parade OS — Deck pitch série",
    kind: "product",
    status: "active",
    color: "#06B6D4",
    description:
      "Retravail du deck de pitch pour la série animée Parade. Alignement associés + partenaires.",
  },
  {
    name: "Studio Chanson",
    kind: "product",
    status: "active",
    color: "#F97316",
  },
  {
    name: "Pilotes TV clips IA",
    kind: "product",
    status: "active",
    color: "#A855F7",
  },
  {
    name: "Horatio 2",
    kind: "product",
    status: "active",
    color: "#0891B2",
  },
  {
    name: "Bons de commandes Auto",
    kind: "product",
    status: "active",
    color: "#65A30D",
  },
  {
    name: "Calculus",
    kind: "product",
    status: "active",
    color: "#DC2626",
  },

  // Transverses (kind=transverse)
  {
    name: "Prospection Waalaxy",
    kind: "transverse",
    status: "on_hold",
    description:
      "Prospection LinkedIn via Waalaxy : Sales Navigator, listes prospects, séquences messages.",
  },
  { name: "Sales", kind: "transverse", status: "active" },
  { name: "Formation", kind: "transverse", status: "active" },
  { name: "Administratif", kind: "transverse", status: "active" },
  { name: "Coworking", kind: "transverse", status: "active" },
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

  const [admin] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"))
    .limit(1);

  if (!admin) throw new Error("Aucun user admin. Lance `pnpm seed`.");
  const adminId: string = admin.id;

  console.info(`Import Notion : ${OPPORTUNITIES.length} opportunités, ${PROJECTS.length} projets.`);

  const entityIdByName = new Map<string, string>();

  async function upsertEntity(name: string, kindHint: "client" | "prospect"): Promise<string> {
    const cached = entityIdByName.get(name);
    if (cached) return cached;

    const [existing] = await db
      .select({ id: entitiesTable.id, kind: entitiesTable.kind })
      .from(entitiesTable)
      .where(ilike(entitiesTable.name, name))
      .limit(1);

    if (existing) {
      // Promotion silencieuse prospect → client si nécessaire.
      if (kindHint === "client" && existing.kind !== "client") {
        await db
          .update(entitiesTable)
          .set({ kind: "client" })
          .where(eq(entitiesTable.id, existing.id));
      }
      entityIdByName.set(name, existing.id);
      return existing.id;
    }

    const [created] = await db
      .insert(entitiesTable)
      .values({
        name,
        kind: kindHint,
        ownerId: adminId,
        createdBy: adminId,
      })
      .returning({ id: entitiesTable.id });

    if (!created) throw new Error(`Échec création entité ${name}`);
    entityIdByName.set(name, created.id);
    console.info(`    + entité créée : ${name} (${kindHint})`);
    return created.id;
  }

  // ---------- Opportunités : upsert (par titre) ----------
  console.info("\n— Opportunités —");
  for (const seed of OPPORTUNITIES) {
    const entityId = seed.entityName
      ? await upsertEntity(seed.entityName, seed.status === "won" ? "client" : "prospect")
      : null;

    const [existing] = await db
      .select({
        id: opportunitiesTable.id,
        status: opportunitiesTable.status,
      })
      .from(opportunitiesTable)
      .where(ilike(opportunitiesTable.title, seed.title))
      .limit(1);

    if (existing) {
      if (existing.status !== seed.status) {
        await db
          .update(opportunitiesTable)
          .set({
            status: seed.status,
            probability: DEFAULT_PROBABILITY[seed.status],
          })
          .where(eq(opportunitiesTable.id, existing.id));
        console.info(`  ↻ ${seed.title} : ${existing.status} → ${seed.status}`);
      } else {
        console.info(`  · ${seed.title} (${seed.status})`);
      }
      continue;
    }

    await db.insert(opportunitiesTable).values({
      title: seed.title,
      status: seed.status,
      entityId,
      probability: DEFAULT_PROBABILITY[seed.status],
      source: seed.source ?? null,
      notes: seed.notes ?? null,
      ownerId: adminId,
      createdBy: adminId,
    });
    console.info(`  ✓ ${seed.title} (${seed.status})`);
  }

  // ---------- Projets : upsert (par nom) ----------
  console.info("\n— Projets —");
  for (const seed of PROJECTS) {
    const entityId = seed.entityName ? await upsertEntity(seed.entityName, "client") : null;

    const [existing] = await db
      .select({
        id: projectsTable.id,
        status: projectsTable.status,
        kind: projectsTable.kind,
      })
      .from(projectsTable)
      .where(ilike(projectsTable.name, seed.name))
      .limit(1);

    if (existing) {
      const needsUpdate = existing.status !== seed.status || existing.kind !== seed.kind;
      if (needsUpdate) {
        await db
          .update(projectsTable)
          .set({
            status: seed.status,
            kind: seed.kind,
            entityId,
          })
          .where(eq(projectsTable.id, existing.id));
        console.info(
          `  ↻ ${seed.name} : ${existing.kind}/${existing.status} → ${seed.kind}/${seed.status}`,
        );
      } else {
        console.info(`  · ${seed.name} (${seed.kind}/${seed.status})`);
      }
      continue;
    }

    await db.insert(projectsTable).values({
      name: seed.name,
      kind: seed.kind,
      status: seed.status,
      entityId,
      description: seed.description ?? null,
      icon: seed.icon ?? null,
      color: seed.color ?? null,
      ownerId: adminId,
      createdBy: adminId,
    });
    console.info(`  ✓ ${seed.name} (${seed.kind}/${seed.status})`);
  }

  await sqlClient.end({ timeout: 5 });
  console.info("\nImport terminé.");
}

main().catch((err) => {
  console.error("Import échoué :", err);
  process.exit(1);
});
