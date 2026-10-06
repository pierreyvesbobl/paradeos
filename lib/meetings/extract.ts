import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { LLM_BUDGET_MS, withLlmTimeout } from "@/lib/llm/timeout";
import { DEFAULT_LLM_MODEL } from "@/lib/schemas/integrations";
import { getSetting, SETTING_KEYS } from "@/lib/settings";

/**
 * Borne du transcript envoyé au LLM (~30k tokens). Un enregistrement de
 * deux heures dépasse 150k caractères ; sans borne, le coût par
 * extraction est illimité. Même logique que MAX_BODY_CHARS_FOR_LLM
 * côté email.
 */
const MAX_TRANSCRIPT_CHARS_FOR_LLM = 120_000;

import { asc, desc, eq, sql } from "drizzle-orm";
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
      // Nullable : forcer une chaîne pousse le modèle à écrire
      // littéralement "null" quand la signature ne donne qu'un prénom
      // (« Frédéric », m.frederic@…). Cette chaîne se propageait
      // ensuite jusqu'en base et à l'affichage.
      lastName: z.string().nullable(),
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
  contacts: {
    fullName: string;
    entityName: string | null;
    jobTitle: string | null;
    /** Injecté dans le prompt : c'est le discriminant le plus fiable. */
    email: string | null;
  }[];
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
        email: contacts.email,
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
      email: r.email ?? null,
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
          // L'email d'abord : une signature de mail le porte presque
          // toujours, et c'est ce qui permet au modèle de reconnaître une
          // personne déjà connue même quand le nom est écrit autrement.
          if (c.email) bits.push(c.email);
          if (c.jobTitle) bits.push(c.jobTitle);
          if (c.entityName) bits.push(`@ ${c.entityName}`);
          return `- ${bits.join(" — ")}`;
        })
        .join("\n")}`,
    );
  }

  if (v.projects.length > 0) {
    // Groupés par client, et plus à plat : la décision « ré-mention ou
    // nouveau projet » se prend en relisant les projets d'UN client, pas en
    // cherchant un nom dans une liste de deux cents lignes.
    const byEntity = new Map<string, typeof v.projects>();
    for (const p of v.projects) {
      const key = p.entityName ?? "Projets internes (sans client)";
      byEntity.set(key, [...(byEntity.get(key) ?? []), p]);
    }
    const blocks = [...byEntity.entries()]
      .map(
        ([entity, list]) =>
          `${entity} :\n${list.map((p) => `  - ${p.name} (${p.kind}, ${p.status})`).join("\n")}`,
      )
      .join("\n");
    sections.push(
      `Projets / deals existants, groupés par client (un projet couvre tout
le cycle commercial → delivery). Avant de proposer un projet pour un
client, relis la liste de CE client :\n${blocks}`,
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
 * Ce que l'on sait de la réunion *avant* de lire le transcript : son
 * titre et, quand la source la portait, sa date.
 *
 * Un titre de réunion nomme souvent le client, le projet ou les
 * personnes présentes là où le transcript ne dit que « on ». Ne pas le
 * donner au modèle, c'était lui demander de deviner ce qui était écrit
 * en clair sur le fichier.
 */
export type MeetingContext = {
  title: string;
  /** Date déjà établie par la source. Le modèle ne doit pas la contredire. */
  occurredAt: Date | null;
};

export type ProjectContext = {
  name: string;
  entityName: string | null;
  contacts: { fullName: string; jobTitle: string | null }[];
};

/**
 * Personnes déclarées présentes à la réunion (cf. `meeting_participants`).
 * Le type vit ici pour éviter un cycle d'import avec
 * `lib/meetings/participants.ts`, qui consomme les fuzzy matchers.
 */
export type ParticipantContext = {
  name: string;
  kind: "internal" | "external" | "unknown";
  role: string | null;
  entityName: string | null;
};

function buildSystemPrompt(
  vocab: Vocabulary,
  projectContext?: ProjectContext,
  participants?: ParticipantContext[],
  meetingContext?: MeetingContext,
): string {
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
- Pour les contacts, sépare clairement firstName / lastName. Si le nom de famille est introuvable, mets la valeur JSON null, jamais la chaîne « null » ni un nom inventé.
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
4. **Ré-mention d'un projet existant** vs **nouveau projet**. C'est la
   décision la plus coûteuse à rater : un projet en doublon pollue le CRM,
   se traîne dans les filtres et les rapports, et il faut aller fusionner
   deux historiques à la main. Procède dans cet ordre :

   a. Trouve le client dont il est question, puis **relis la liste de SES
      projets** dans le vocabulaire ci-dessous. La question n'est jamais
      « ce nom est-il dans la liste ? » mais « l'un de ses projets
      désigne-t-il déjà cet objet ? ».
   b. **C'est une ré-mention** — donc on ne propose rien, on raconte
      l'avancée dans le résumé — dès que le transcript parle du même objet,
      même s'il le dit autrement. Sont des ré-mentions :
      - le même objet reformulé : « automatisation des devis et de la
        facturation » quand le projet s'appelle « Automatisation process » ;
      - une phase, un lot, une étape ou une relance du même objet : un
        projet couvre tout son cycle (cf. \`status\`), il n'y a pas de
        « phase 2 » séparée ;
      - le même objet sous un angle technique différent (l'outil, le
        fichier, le format changent, l'objet non).
   c. **C'est un nouveau projet** seulement si le transcript nomme un objet
      que tu peux distinguer en une phrase de chacun des projets existants
      du client — une autre livraison, un autre besoin, un autre budget.
      Alors donne-lui un nom qui dit cet objet-là, pas un nom générique.
   d. **En cas de doute, c'est une ré-mention.** Le doute lui-même est le
      signe que l'objet n'est pas distinguable des projets existants.
   e. Si tu ne sais pas nommer le projet dont on parle, **ne propose pas de
      projet** et n'invente jamais un nom de remplissage : « Projet en
      cours », « Suivi de projet », « À définir » ne sont pas des noms et
      seront jetés.`;

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

  if (meetingContext) {
    const lines = [
      `Titre de la réunion (tel que la source l'a nommée) : « ${meetingContext.title} »`,
    ];
    if (meetingContext.occurredAt) {
      lines.push(
        `Date et heure déjà établies : ${meetingContext.occurredAt.toISOString()}.`,
        "→ Reprends cette valeur dans `occurredAt`. Ne la recalcule pas depuis le transcript.",
      );
    }
    lines.push(
      "",
      "Ce titre est une source de premier ordre, souvent plus explicite que le",
      "transcript : il nomme fréquemment le client, le projet ou les personnes",
      "présentes là où le transcript ne dit que « on » et « le projet ».",
      "Exploite-le pour rattacher la réunion au bon projet et aux bonnes",
      "personnes du vocabulaire ci-dessous. Il reste indicatif : n'invente pas",
      "un projet à partir d'un titre qui n'en nomme aucun.",
    );
    contextBlock += `\n\n---\n\n# Contexte de la réunion\n\n${lines.join("\n")}`;
  }

  if (participants && participants.length > 0) {
    const line = (p: ParticipantContext) => {
      const bits = [p.name];
      if (p.role) bits.push(p.role);
      if (p.kind === "internal") bits.push("équipe Paradeos");
      else if (p.entityName) bits.push(p.entityName);
      else if (p.kind === "external") bits.push("externe");
      return `- ${bits.join(" — ")}`;
    };
    contextBlock += `\n\n---\n\n# Participants de la réunion

Ces personnes étaient présentes (liste tenue à la main dans Parade OS,
elle fait foi sur le transcript) :

${participants.map(line).join("\n")}

Règles :
- Résous les prénoms seuls, surnoms et "je / tu / on m'a dit" vers ces
  personnes en priorité, avec l'orthographe exacte ci-dessus.
- "Je m'en occupe" dit par un membre de l'équipe → tâche assignée à ce
  membre (assigneeKind="internal"). Dit par un externe → assigneeKind="external".
- Dans \`attendees\`, reprends ces personnes si le transcript les fait
  parler, et ajoute celles que la liste ne connaît pas encore. N'invente
  personne.`;
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
  options?: {
    projectContext?: ProjectContext;
    participants?: ParticipantContext[];
    meetingContext?: MeetingContext;
  },
): Promise<MeetingExtraction> {
  const apiKey = await getSetting(SETTING_KEYS.OPENROUTER_API_KEY);
  if (!apiKey) {
    throw new Error("Clé OpenRouter non configurée. Ajoute-la dans /settings/integrations.");
  }
  const modelId = (await getSetting(SETTING_KEYS.LLM_MODEL)) ?? DEFAULT_LLM_MODEL;

  const vocab = await getKnownVocabulary();
  const systemPrompt = buildSystemPrompt(
    vocab,
    options?.projectContext,
    options?.participants,
    options?.meetingContext,
  );

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

  const boundedTranscript =
    transcript.length > MAX_TRANSCRIPT_CHARS_FOR_LLM
      ? `${transcript.slice(0, MAX_TRANSCRIPT_CHARS_FOR_LLM)}\n\n[transcript tronqué]`
      : transcript;
  const { object } = await withLlmTimeout(
    {
      budgetMs: LLM_BUDGET_MS.meetingExtraction,
      modelId,
      label: "l'extraction de la réunion",
    },
    (signal) =>
      generateObject({
        abortSignal: signal,
        model: openrouter(modelId),
        schema: extractionSchema,
        system: systemPrompt,
        prompt: `Transcript :\n\n${boundedTranscript}`,
        temperature: 0.2,
      }),
  );

  return object;
}
