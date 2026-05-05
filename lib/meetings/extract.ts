import "server-only";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { opportunities } from "@/db/schema/opportunities";
import { projects } from "@/db/schema/projects";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

const MODEL_ID = "gpt-4.1";

// Limite la taille du vocabulaire injecté pour ne pas exploser le prompt
// si la base devient très grande. On priorise les records les plus
// récents — on peut affiner plus tard (par dernier contact, etc.).
const VOCAB_LIMIT_PER_KIND = 200;

/**
 * Note : OpenAI Structured Outputs exigent que **chaque** propriété soit
 * marquée `required`. Pas de `.optional()` ni `.default()` ici — on
 * accepte explicitement `null` pour les champs vides, et on demande des
 * tableaux vides plutôt qu'absents pour les listes.
 */
const extractionSchema = z.object({
  summary: z.string(),
  occurredAt: z.string().nullable(),
  attendees: z.array(
    z.object({
      name: z.string(),
      email: z.string().nullable(),
      role: z.string().nullable(),
    }),
  ),
  decisions: z.array(z.string()),
  proposedEntities: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["client", "prospect", "partner", "supplier", "other"]).nullable(),
    }),
  ),
  proposedContacts: z.array(
    z.object({
      firstName: z.string(),
      lastName: z.string(),
      email: z.string().nullable(),
      jobTitle: z.string().nullable(),
      entityName: z.string().nullable(),
    }),
  ),
  proposedProjects: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["client", "product", "transverse"]).nullable(),
      entityName: z.string().nullable(),
    }),
  ),
  proposedOpportunities: z.array(
    z.object({
      title: z.string(),
      entityName: z.string().nullable(),
      valueAmount: z.number().nullable(),
    }),
  ),
  proposedTasks: z.array(
    z.object({
      title: z.string(),
      assigneeName: z.string().nullable(),
      dueDate: z.string().nullable(),
      projectName: z.string().nullable(),
      priority: z.enum(["low", "normal", "high"]).nullable(),
    }),
  ),
});

export type MeetingExtraction = z.infer<typeof extractionSchema>;

type Vocabulary = {
  entities: { name: string; kind: string }[];
  contacts: { fullName: string; entityName: string | null; jobTitle: string | null }[];
  projects: { name: string; kind: string; linkedOpportunityTitle: string | null }[];
  opportunities: {
    title: string;
    entityName: string | null;
    status: string;
    linkedProjectName: string | null;
  }[];
  users: string[];
};

/**
 * Charge le vocabulaire existant en base. Injecté dans le prompt LLM
 * pour qu'il utilise les noms canoniques quand le transcript en parle
 * de façon approximative — phonétique, acronymes, prénom seul…
 */
async function getKnownVocabulary(): Promise<Vocabulary> {
  const conn = await db();

  const [entityRows, contactRows, projectRows, oppRows, userRows] = await Promise.all([
    conn
      .select({ name: entities.name, kind: entities.kind, updatedAt: entities.updatedAt })
      .from(entities)
      .orderBy(desc(entities.updatedAt))
      .limit(VOCAB_LIMIT_PER_KIND),
    conn
      .select({
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        jobTitle: contacts.jobTitle,
        entityName: entities.name,
        updatedAt: contacts.updatedAt,
      })
      .from(contacts)
      .leftJoin(entities, eq(contacts.entityId, entities.id))
      .orderBy(desc(contacts.updatedAt))
      .limit(VOCAB_LIMIT_PER_KIND),
    conn
      .select({
        name: projects.name,
        kind: projects.kind,
        linkedOpportunityTitle: opportunities.title,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .leftJoin(opportunities, eq(opportunities.projectId, projects.id))
      .orderBy(desc(projects.updatedAt))
      .limit(VOCAB_LIMIT_PER_KIND),
    conn
      .select({
        title: opportunities.title,
        entityName: entities.name,
        status: opportunities.status,
        linkedProjectName: projects.name,
        updatedAt: opportunities.updatedAt,
      })
      .from(opportunities)
      .leftJoin(entities, eq(opportunities.entityId, entities.id))
      .leftJoin(projects, eq(opportunities.projectId, projects.id))
      .orderBy(desc(opportunities.updatedAt))
      .limit(VOCAB_LIMIT_PER_KIND),
    conn.select({ fullName: users.fullName }).from(users).orderBy(asc(users.fullName)),
  ]);

  return {
    entities: entityRows.map((r) => ({ name: r.name, kind: r.kind })),
    contacts: contactRows.map((r) => ({
      fullName: `${r.firstName} ${r.lastName}`.trim(),
      entityName: r.entityName ?? null,
      jobTitle: r.jobTitle ?? null,
    })),
    projects: projectRows.map((r) => ({
      name: r.name,
      kind: r.kind,
      linkedOpportunityTitle: r.linkedOpportunityTitle ?? null,
    })),
    opportunities: oppRows.map((r) => ({
      title: r.title,
      entityName: r.entityName ?? null,
      status: r.status,
      linkedProjectName: r.linkedProjectName ?? null,
    })),
    users: userRows.map((u) => u.fullName).filter((n): n is string => !!n),
  };
}

function formatVocabulary(v: Vocabulary): string {
  const sections: string[] = [];

  if (v.users.length > 0) {
    sections.push(
      `Membres de l'équipe (assignés possibles) :\n${v.users.map((n) => `- ${n}`).join("\n")}`,
    );
  }

  if (v.entities.length > 0) {
    sections.push(
      `Entités (clients / prospects / partenaires / fournisseurs) :\n${v.entities
        .map((e) => `- ${e.name} (${e.kind})`)
        .join("\n")}`,
    );
  }

  if (v.contacts.length > 0) {
    sections.push(
      `Contacts :\n${v.contacts
        .map((c) => {
          const bits = [c.fullName];
          if (c.jobTitle) bits.push(c.jobTitle);
          if (c.entityName) bits.push(`@ ${c.entityName}`);
          return `- ${bits.join(" — ")}`;
        })
        .join("\n")}`,
    );
  }

  if (v.projects.length > 0) {
    sections.push(
      `Projets (missions engagées) :\n${v.projects
        .map((p) => {
          const bits = [`${p.name} (${p.kind})`];
          if (p.linkedOpportunityTitle)
            bits.push(`← issu de l'opportunité « ${p.linkedOpportunityTitle} »`);
          return `- ${bits.join(" ")}`;
        })
        .join("\n")}`,
    );
  }

  if (v.opportunities.length > 0) {
    sections.push(
      `Opportunités (ventes, à différents stades) :\n${v.opportunities
        .map((o) => {
          const bits = [o.title];
          if (o.entityName) bits.push(`(${o.entityName})`);
          bits.push(`statut: ${o.status}`);
          if (o.linkedProjectName)
            bits.push(`→ déjà convertie en projet « ${o.linkedProjectName} »`);
          return `- ${bits.join(" ")}`;
        })
        .join("\n")}`,
    );
  }

  return sections.join("\n\n");
}

function buildSystemPrompt(vocab: Vocabulary): string {
  const baseRules = `Tu es un assistant qui dépouille un transcript de meeting professionnel
et en extrait :
- un résumé concis en français (markdown, 5 à 10 lignes max),
- les décisions prises,
- les entités, contacts, projets et opportunités évoqués,
- les tâches à faire avec leur assigné·e si mentionné·e.

Règles générales :
- Ne pas inventer. Si un champ n'est pas explicite, retourne null.
- Pour les listes (attendees, decisions, proposed*), si rien à extraire,
  retourne un tableau vide [], jamais omis.
- Pour les contacts, sépare clairement firstName / lastName.
- Pour les tâches, dueDate au format YYYY-MM-DD si une date est mentionnée.
- Pour les opportunités, valueAmount en euros, sans symbole.
- Reste factuel et neutre dans le résumé.

# Distinction CRUCIALE : opportunité vs projet

Le système distingue deux objets liés mais différents :

- **Opportunité** = une vente / un deal commercial à différents stades
  (prospection, proposition envoyée, à relancer, signée, perdue). Elle
  a une probabilité, un montant prévisionnel.
- **Projet** = une mission engagée, après signature ou décision interne
  d'allouer des ressources. Il a un budget, une période, des tâches.

Une opportunité gagnée donne lieu à un projet (cycle naturel). C'est
donc **deux objets pour la même affaire à des stades différents**.

Règles d'extraction :
1. **Ne propose PAS les deux** pour la même affaire. Choisis le bon
   stade selon le transcript :
   - "on bosse sur X pour le client Y", "tâches X", "deadline X" → **projet**
   - "on essaie de signer X", "proposition envoyée", "relance" → **opportunité**
   - "on a signé X", "X est lancé" → **projet** (avec mention dans le résumé
     que ça vient d'une opportunité gagnée)
2. **Si une opportunité du vocabulaire est marquée "→ déjà convertie en
   projet"** : ne propose ni l'opportunité ni un nouveau projet pour la
   même affaire — tout existe déjà. Mentionne juste le projet existant
   dans le résumé.
3. **Si un projet du vocabulaire est marqué "← issu de l'opportunité X"** :
   pareil, ne re-propose pas l'opportunité X.
4. Quand il y a doute, **préfère l'opportunité** (un humain peut la
   convertir en projet ; l'inverse est plus coûteux).`;

  const vocabBlock = formatVocabulary(vocab);
  if (vocabBlock.length === 0) return baseRules;

  return `${baseRules}

---

# Vocabulaire connu (utiliser EN PRIORITÉ)

Voici les noms canoniques déjà en base. Si le transcript mentionne quelque
chose qui leur ressemble — orthographe phonétique, acronyme, prénom seul,
nom de famille seul, abréviation, faute de transcription — alors retourne
**l'orthographe exacte de la liste**, pas celle du transcript. Cela permet
la résolution automatique côté serveur.

Exemples :
- transcript "Pierre Yves" → retourne "Pierre-Yves Sage" (s'il est listé)
- transcript "Acmé" → retourne "Acme Corp" (s'il est listé)
- transcript "le projet Refonte" → retourne le nom complet du projet listé
  qui contient "Refonte"

Si le transcript parle d'une entité/contact/projet **clairement absent**
de la liste, retourne le nom du transcript tel quel (la proposition
restera marquée "à créer").

${vocabBlock}`;
}

export async function extractMeeting(transcript: string): Promise<MeetingExtraction> {
  const apiKey = await getSetting(SETTING_KEYS.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("Clé OpenAI non configurée. Ajoute-la dans /settings/integrations.");
  }

  const vocab = await getKnownVocabulary();
  const systemPrompt = buildSystemPrompt(vocab);
  const openai = createOpenAI({ apiKey });

  const { object } = await generateObject({
    model: openai(MODEL_ID),
    schema: extractionSchema,
    system: systemPrompt,
    prompt: `Transcript :\n\n${transcript}`,
    temperature: 0.2,
  });

  return object;
}

/**
 * Match fuzzy par similarité pg_trgm. Retourne le meilleur candidat
 * avec son score si > seuil minimum.
 */
export type Match = { id: string; name: string; confidence: number } | null;

export async function fuzzyMatchEntity(name: string, threshold = 0.6): Promise<Match> {
  const conn = await db();
  const rows = await conn
    .select({
      id: entities.id,
      name: entities.name,
      sim: sql<number>`similarity(${entities.name}, ${name})`,
    })
    .from(entities)
    .where(sql`similarity(${entities.name}, ${name}) > ${threshold}`)
    .orderBy(sql`similarity(${entities.name}, ${name}) desc`)
    .limit(1);
  const top = rows[0];
  return top ? { id: top.id, name: top.name, confidence: Number(top.sim) } : null;
}

export async function fuzzyMatchContact(
  firstName: string,
  lastName: string,
  threshold = 0.55,
): Promise<Match> {
  const conn = await db();
  const full = `${firstName} ${lastName}`.trim();
  const rows = await conn
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      sim: sql<number>`similarity(${contacts.firstName} || ' ' || ${contacts.lastName}, ${full})`,
    })
    .from(contacts)
    .where(
      sql`similarity(${contacts.firstName} || ' ' || ${contacts.lastName}, ${full}) > ${threshold}`,
    )
    .orderBy(sql`similarity(${contacts.firstName} || ' ' || ${contacts.lastName}, ${full}) desc`)
    .limit(1);
  const top = rows[0];
  return top
    ? { id: top.id, name: `${top.firstName} ${top.lastName}`, confidence: Number(top.sim) }
    : null;
}

export async function fuzzyMatchProject(name: string, threshold = 0.4): Promise<Match> {
  const conn = await db();
  const rows = await conn
    .select({
      id: projects.id,
      name: projects.name,
      sim: sql<number>`similarity(${projects.name}, ${name})`,
    })
    .from(projects)
    .where(sql`similarity(${projects.name}, ${name}) > ${threshold}`)
    .orderBy(sql`similarity(${projects.name}, ${name}) desc`)
    .limit(1);
  const top = rows[0];
  return top ? { id: top.id, name: top.name, confidence: Number(top.sim) } : null;
}

export async function fuzzyMatchOpportunity(title: string, threshold = 0.4): Promise<Match> {
  const conn = await db();
  const rows = await conn
    .select({
      id: opportunities.id,
      title: opportunities.title,
      sim: sql<number>`similarity(${opportunities.title}, ${title})`,
    })
    .from(opportunities)
    .where(sql`similarity(${opportunities.title}, ${title}) > ${threshold}`)
    .orderBy(sql`similarity(${opportunities.title}, ${title}) desc`)
    .limit(1);
  const top = rows[0];
  return top ? { id: top.id, name: top.title, confidence: Number(top.sim) } : null;
}

export async function fuzzyMatchUser(name: string, threshold = 0.35): Promise<Match> {
  const conn = await db();
  const rows = await conn
    .select({
      id: users.id,
      name: users.fullName,
      sim: sql<number>`similarity(coalesce(${users.fullName}, ''), ${name})`,
    })
    .from(users)
    .where(sql`similarity(coalesce(${users.fullName}, ''), ${name}) > ${threshold}`)
    .orderBy(sql`similarity(coalesce(${users.fullName}, ''), ${name}) desc`)
    .limit(1);
  const top = rows[0];
  return top ? { id: top.id, name: top.name ?? "(sans nom)", confidence: Number(top.sim) } : null;
}
