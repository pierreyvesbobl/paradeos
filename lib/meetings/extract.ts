import "server-only";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { projects } from "@/db/schema/projects";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { asc, desc, sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { z } from "zod";

const MODEL_ID = "gpt-4.1";

// Limite la taille du vocabulaire injecté pour ne pas exploser le prompt
// si la base devient très grande.
const VOCAB_LIMIT_PER_KIND = 200;

/**
 * OpenAI Structured Outputs exigent que **chaque** propriété soit
 * marquée `required`. Pas de `.optional()` ni `.default()` ici — on
 * accepte explicitement `null` pour les champs vides, et on demande des
 * tableaux vides plutôt qu'absents pour les listes.
 *
 * Avec la fusion opportunities → projects, le LLM ne propose plus
 * d'opportunités séparées : un deal commercial est un projet en statut
 * pré-won. Le champ `proposedCommercialStatus` indique si le projet
 * proposé est encore au stade commercial.
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
      /**
       * Statut suggéré par le LLM. `not_started`/`to_follow_up`/`awaiting_response`
       * = phase commerciale ; `active`/`planning` = delivery démarré ;
       * `won` = signé et delivery imminente.
       */
      status: z
        .enum(["not_started", "to_follow_up", "awaiting_response", "won", "planning", "active"])
        .nullable(),
      /** Montant prévisionnel (€HT) si mentionné — pertinent en phase commerciale. */
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
  projects: { name: string; kind: string; status: string; entityName: string | null }[];
  users: string[];
};

/**
 * Charge le vocabulaire existant en base. Injecté dans le prompt LLM
 * pour qu'il utilise les noms canoniques quand le transcript en parle
 * de façon approximative — phonétique, acronymes, prénom seul…
 */
async function getKnownVocabulary(): Promise<Vocabulary> {
  const conn = await db();

  const [entityRows, contactRows, projectRows, userRows] = await Promise.all([
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
        status: projects.status,
        entityName: entities.name,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .leftJoin(entities, eq(projects.entityId, entities.id))
      .orderBy(desc(projects.updatedAt))
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
      status: r.status,
      entityName: r.entityName ?? null,
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
      `Projets / deals (couvre tout le cycle commercial → delivery) :\n${v.projects
        .map((p) => {
          const bits = [`${p.name} (${p.kind}, ${p.status})`];
          if (p.entityName) bits.push(`pour ${p.entityName}`);
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
- les entités, contacts et projets/deals évoqués,
- les tâches à faire avec leur assigné·e si mentionné·e.

Règles générales :
- Ne pas inventer. Si un champ n'est pas explicite, retourne null.
- Pour les listes (attendees, decisions, proposed*), si rien à extraire,
  retourne un tableau vide [], jamais omis.
- Pour les contacts, sépare clairement firstName / lastName.
- Pour les tâches, dueDate au format YYYY-MM-DD si une date est mentionnée.
- Pour les projets, valueAmount en euros (sans symbole) si mentionné.
- Reste factuel et neutre dans le résumé.

# Projet (objet unique couvrant tout le cycle)

Un projet/deal couvre **tout le cycle**, de la prospection commerciale à la
delivery, dans une seule entité. Le \`status\` indique où on en est :

- **not_started** : prospection en cours, pas encore relancé.
- **to_follow_up** : à relancer côté commercial.
- **awaiting_response** : proposition envoyée, en attente de réponse.
- **won** : deal signé, delivery imminente.
- **planning** / **active** : delivery démarrée.

Règles :
1. **Un seul projet par affaire**, quel que soit le stade. Ne propose pas
   un "projet" et un "deal" séparés.
2. Choisis le \`status\` selon le langage du transcript :
   - "on essaie de signer X", "proposition envoyée à X" → **awaiting_response**
   - "on a signé X" → **won**
   - "on bosse sur X", "tâches X", "deadline X" → **active**
3. Pour les projets internes (kind=product/transverse), \`status\` est
   normalement \`active\` directement.
4. **Si un projet du vocabulaire correspond** : ne re-propose pas, mentionne
   juste l'avancée dans le résumé.`;

  const vocabBlock = formatVocabulary(vocab);
  if (vocabBlock.length === 0) return baseRules;

  return `${baseRules}

---

# Vocabulaire connu (utiliser EN PRIORITÉ)

Voici les noms canoniques déjà en base. Si le transcript mentionne quelque
chose qui leur ressemble — orthographe phonétique, acronyme, prénom seul,
nom de famille seul, abréviation, faute de transcription — alors retourne
**l'orthographe exacte de la liste**, pas celle du transcript.

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
