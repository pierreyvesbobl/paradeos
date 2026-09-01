import "server-only";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { DEFAULT_LLM_MODEL } from "@/lib/schemas/integrations";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { asc, desc, sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { formatPersonName } from "@/lib/format";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

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
      /**
       * `internal` = membre Paradeos (table users). `external` = personne
       * côté client/partenaire (table contacts). Permet de router la tâche
       * vers la bonne FK à l'acceptation et d'afficher un badge.
       */
      assigneeKind: z.enum(["internal", "external"]).nullable(),
      dueDate: z.string().nullable(),
      projectName: z.string().nullable(),
      priority: z.enum(["low", "normal", "high"]).nullable(),
    }),
  ),
});

export type MeetingExtraction = z.infer<typeof extractionSchema>;

export type Vocabulary = {
  entities: { name: string; kind: string }[];
  contacts: { fullName: string; entityName: string | null; jobTitle: string | null }[];
  projects: { name: string; kind: string; status: string; entityName: string | null }[];
  users: string[];
  /** Tâches encore ouvertes — pour éviter de re-proposer une action déjà notée. */
  tasks: { title: string; projectName: string | null; status: string }[];
};

/**
 * Charge le vocabulaire existant en base. Injecté dans le prompt LLM
 * pour qu'il utilise les noms canoniques quand le transcript en parle
 * de façon approximative — phonétique, acronymes, prénom seul…
 *
 * Exporté pour réutilisation par le pipeline email (mêmes données
 * canoniques, mêmes limites).
 */
export async function getKnownVocabulary(): Promise<Vocabulary> {
  const conn = await db();

  const [entityRows, contactRows, projectRows, userRows, taskRows] = await Promise.all([
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
    // Tâches encore ouvertes — sert au LLM pour ne pas re-proposer une
    // action déjà tracée. On exclut done/cancelled/archived. Ordonne par
    // updatedAt desc pour prioriser les plus récentes / actives.
    conn
      .select({
        title: tasks.title,
        status: tasks.status,
        projectName: projects.name,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(sql`${tasks.status} not in ('done', 'cancelled')`)
      .orderBy(desc(tasks.updatedAt))
      .limit(VOCAB_LIMIT_PER_KIND),
  ]);

  return {
    entities: entityRows.map((r) => ({ name: r.name, kind: r.kind })),
    contacts: contactRows.map((r) => ({
      fullName: formatPersonName(r.firstName, r.lastName),
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
    tasks: taskRows.map((r) => ({
      title: r.title,
      status: r.status,
      projectName: r.projectName ?? null,
    })),
  };
}

export function formatVocabulary(v: Vocabulary): string {
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

  if (v.tasks.length > 0) {
    sections.push(
      `Tâches ouvertes déjà connues (NE PAS re-proposer, même reformulées) :\n${v.tasks
        .map((t) => {
          const bits = [t.title];
          if (t.projectName) bits.push(`— projet ${t.projectName}`);
          bits.push(`[${t.status}]`);
          return `- ${bits.join(" ")}`;
        })
        .join("\n")}`,
    );
  }

  return sections.join("\n\n");
}

/**
 * Fuzzy match d'un titre de tâche parmi les tâches déjà en base, avec
 * scope facultatif sur un projet donné. Sert au dédup côté extraction :
 * si le LLM propose une action déjà tracée sur ce projet, on peut skip
 * la proposition (cf. `extract-and-save.ts` pour meetings et emails).
 *
 * Seuil bas (0.4) — on préfère skip trop que pas assez ; l'utilisateur
 * peut toujours créer manuellement s'il veut vraiment une 2e tâche.
 */
export async function fuzzyMatchTaskInProject(
  title: string,
  projectId: string | null,
  threshold = 0.4,
): Promise<Match> {
  const conn = await db();
  const scope = projectId
    ? sql`${tasks.projectId} = ${projectId}`
    : sql`${tasks.projectId} is null`;
  const rows = await conn
    .select({
      id: tasks.id,
      name: tasks.title,
      sim: sql<number>`similarity(${tasks.title}, ${title})`,
    })
    .from(tasks)
    .where(
      sql`${scope} and ${tasks.status} not in ('done', 'cancelled') and similarity(${tasks.title}, ${title}) > ${threshold}`,
    )
    .orderBy(sql`similarity(${tasks.title}, ${title}) desc`)
    .limit(1);
  const top = rows[0];
  return top ? { id: top.id, name: top.name, confidence: Number(top.sim) } : null;
}

export type ProjectContext = {
  name: string;
  entityName: string | null;
  contacts: { fullName: string; jobTitle: string | null }[];
};

function buildSystemPrompt(vocab: Vocabulary, projectContext?: ProjectContext): string {
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

# Tâches : interne vs externe

Pour chaque tâche, identifie qui doit la faire :
- **assigneeKind="internal"** quand l'action incombe à un **membre de l'équipe Paradeos**
  (cf. liste "Membres de l'équipe" dans le vocabulaire ci-dessous).
- **assigneeKind="external"** quand l'action incombe à une **personne extérieure** :
  contact client, partenaire, fournisseur (cf. liste "Contacts" ci-dessous).
- Si pas d'assigné explicite ou impossible à déterminer : assigneeKind=null.

Exemple : "Sophie envoie la maquette mardi prochain" → si Sophie est dans "Membres
de l'équipe" → internal ; si Sophie est dans "Contacts" → external.

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
4. **Ré-mention d'un projet existant** vs **nouveau projet** :
   - Si le transcript parle du MÊME deal/projet qu'un projet du vocabulaire
     (même objet, même périmètre) → ne re-propose pas, mentionne l'avancée
     dans le résumé.
   - Si le transcript parle d'un NOUVEAU deal/projet pour une entité qui a
     déjà d'autres projets → propose-le comme nouveau projet (nom distinct),
     même si l'entité est la même. Ne fusionne pas deux objets différents
     sous prétexte qu'ils partagent le client. En cas de doute, choisis
     "nouveau projet" plutôt que "ré-mention" — un doublon est plus facile
     à rejeter qu'un projet manqué.`;

  const vocabBlock = formatVocabulary(vocab);

  let contextBlock = "";
  if (projectContext) {
    const lines = [
      `Ce meeting est rattaché au projet "${projectContext.name}"${projectContext.entityName ? ` (client : ${projectContext.entityName})` : ""}.`,
      "→ Par défaut, projectName des tâches extraites = ce projet. Ne mets un projectName différent que si le transcript parle clairement d'un AUTRE projet.",
    ];
    if (projectContext.contacts.length > 0) {
      lines.push(
        "",
        "Contacts déjà rattachés à ce projet (assignés externes prioritaires) :",
        ...projectContext.contacts.map(
          (c) => `- ${c.fullName}${c.jobTitle ? ` (${c.jobTitle})` : ""}`,
        ),
      );
    }
    contextBlock = `\n\n---\n\n# Contexte projet\n\n${lines.join("\n")}`;
  }

  if (vocabBlock.length === 0) return baseRules + contextBlock;

  return `${baseRules}${contextBlock}

---

# Vocabulaire connu (utiliser EN PRIORITÉ)

Voici les noms canoniques déjà en base. Si le transcript mentionne quelque
chose qui leur ressemble — orthographe phonétique, acronyme, prénom seul,
nom de famille seul, abréviation, faute de transcription — alors retourne
**l'orthographe exacte de la liste**, pas celle du transcript.

${vocabBlock}`;
}

export async function extractMeeting(
  transcript: string,
  options?: { projectContext?: ProjectContext },
): Promise<MeetingExtraction> {
  const apiKey = await getSetting(SETTING_KEYS.OPENROUTER_API_KEY);
  if (!apiKey) {
    throw new Error("Clé OpenRouter non configurée. Ajoute-la dans /settings/integrations.");
  }
  const modelId = (await getSetting(SETTING_KEYS.LLM_MODEL)) ?? DEFAULT_LLM_MODEL;

  const vocab = await getKnownVocabulary();
  const systemPrompt = buildSystemPrompt(vocab, options?.projectContext);

  // OpenRouter expose une API OpenAI-compatible : on réutilise le
  // provider `@ai-sdk/openai` avec un baseURL custom. Les headers
  // `HTTP-Referer` et `X-Title` sont recommandés par OpenRouter pour
  // l'analytique et la priorisation des requêtes free-tier.
  const openrouter = createOpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    headers: {
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://paradeos.vercel.app",
      "X-Title": "Paradeos",
    },
  });

  const { object } = await generateObject({
    model: openrouter(modelId),
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
    ? {
        id: top.id,
        name: formatPersonName(top.firstName, top.lastName),
        confidence: Number(top.sim),
      }
    : null;
}

/**
 * Fuzzy match d'un projet par nom, avec scope entité facultatif.
 *
 * `opts.entityId` :
 *  - `string` → restreint la recherche aux projets de cette entité. Évite
 *    le faux positif "GpasPlus - Nouveau X" ↔ "GpasPlus - Automatisation
 *    des processus" quand le nom d'entité domine la similarité trigram.
 *  - `null` → restreint aux projets internes (entityId is null).
 *  - `undefined` (défaut) → pas de scope.
 *
 * Seuil par défaut relevé à 0.55 : le 0.4 historique faisait matcher deux
 * projets différents partageant seulement le préfixe entité.
 */
export async function fuzzyMatchProject(
  name: string,
  opts?: { entityId?: string | null; threshold?: number },
): Promise<Match> {
  const threshold = opts?.threshold ?? 0.55;
  const conn = await db();
  const conditions = [sql`similarity(${projects.name}, ${name}) > ${threshold}`];
  if (opts && "entityId" in opts) {
    conditions.push(
      opts.entityId === null
        ? sql`${projects.entityId} is null`
        : sql`${projects.entityId} = ${opts.entityId}`,
    );
  }
  const rows = await conn
    .select({
      id: projects.id,
      name: projects.name,
      sim: sql<number>`similarity(${projects.name}, ${name})`,
    })
    .from(projects)
    .where(sql.join(conditions, sql` and `))
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
