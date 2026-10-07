import { sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { secondaryEmailsByContact } from "@/lib/crm/contact-emails";
import { normalizeEmail, normalizeNameKey, personNameKey } from "@/lib/crm/name-key";
import {
  MATCH_THRESHOLD,
  type Match,
  pickBestContact,
  pickBestMatch,
  pickBestProject,
} from "@/lib/crm/pick";

/**
 * Chargement des candidats pour le rapprochement anti-doublon. La logique
 * de décision vit dans `lib/crm/pick.ts` (pure, testée sans base) ; ici on
 * ne fait que lire la table et déléguer.
 *
 * La connexion est **injectée** plutôt qu'importée : le serveur MCP tourne
 * sous tsx, hors pipeline Next, avec son propre client Drizzle
 * (`mcp-server/db.ts`) et ne peut pas charger un module `server-only`.
 * L'app passe par `lib/crm/match.ts`, qui lie ces fonctions à `db()`.
 */

/**
 * Garde-fou de volumétrie : le matching charge les candidats et compare
 * côté application (cf. en-tête de `lib/crm/similarity.ts`). Au-delà de
 * cette taille il faudrait un pré-filtre SQL (index trigram sur une
 * expression immutable) — on est très loin du compte aujourd'hui.
 */
const CANDIDATE_SCAN_LIMIT = 5_000;

export async function matchEntity(
  conn: Database,
  name: string,
  threshold: number = MATCH_THRESHOLD.entity,
): Promise<Match> {
  if (!normalizeNameKey(name)) return null;
  const rows = await conn
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .limit(CANDIDATE_SCAN_LIMIT);
  return pickBestMatch(rows, name, threshold);
}

/**
 * Match d'un contact. Passe `opts.email` dès qu'une adresse est connue :
 * c'est le seul discriminant fort dont on dispose sur une personne. Les
 * candidats portent toutes leurs adresses, secondaires comprises.
 */
export async function matchContact(
  conn: Database,
  firstName: string,
  lastName: string,
  opts?: { email?: string | null; threshold?: number },
): Promise<Match> {
  const threshold = opts?.threshold ?? MATCH_THRESHOLD.contact;
  const email = opts?.email ?? null;
  if (!personNameKey(firstName, lastName) && !normalizeEmail(email)) return null;
  const [rows, secondary] = await Promise.all([
    conn
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
      })
      .from(contacts)
      .limit(CANDIDATE_SCAN_LIMIT),
    secondaryEmailsByContact(conn),
  ]);
  const candidates = rows.map((r) => ({ ...r, emails: secondary.get(r.id) ?? [] }));
  return pickBestContact(candidates, { firstName, lastName, email }, threshold);
}

/**
 * Match d'un projet par nom, avec scope entité facultatif.
 *
 * `opts.entityId` :
 *  - `string` → restreint aux projets de cette entité. Le scope ne sert pas
 *    qu'à éviter un faux positif entre deux clients : il change la façon de
 *    comparer. À l'intérieur d'un client, on retire son nom des deux côtés
 *    et on descend le seuil (`pickBestProject`), ce qui rapproche enfin
 *    « Automatisation devis et facturation ETC » de « Automatisation
 *    process - ETC » sans rapprocher « Mirror Lab » de « Echolab ».
 *  - `null` → restreint aux projets internes (entityId is null). Même
 *    traitement, sans nom de client à retirer.
 *  - `undefined` (défaut) → pas de scope, comparaison symétrique au seuil
 *    haut : sans client pour cadrer, un rapprochement large se tromperait
 *    de dossier.
 */
export async function matchProject(
  conn: Database,
  name: string,
  opts?: { entityId?: string | null; threshold?: number },
): Promise<Match> {
  if (!normalizeNameKey(name)) return null;

  if (!opts || !("entityId" in opts)) {
    const rows = await conn
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .limit(CANDIDATE_SCAN_LIMIT);
    return pickBestMatch(rows, name, opts?.threshold ?? MATCH_THRESHOLD.project);
  }

  const rows = await conn
    .select({ id: projects.id, name: projects.name, entityName: entities.name })
    .from(projects)
    .leftJoin(entities, sql`${entities.id} = ${projects.entityId}`)
    .where(
      opts.entityId === null
        ? sql`${projects.entityId} is null`
        : sql`${projects.entityId} = ${opts.entityId}`,
    )
    .limit(CANDIDATE_SCAN_LIMIT);

  return pickBestProject(
    rows,
    name,
    rows.find((r) => r.entityName)?.entityName ?? null,
    opts.threshold ?? MATCH_THRESHOLD.projectWithinEntity,
  );
}

export async function matchUser(
  conn: Database,
  name: string,
  threshold: number = MATCH_THRESHOLD.user,
): Promise<Match> {
  if (!normalizeNameKey(name)) return null;
  const rows = await conn
    .select({ id: users.id, name: users.fullName })
    .from(users)
    .limit(CANDIDATE_SCAN_LIMIT);
  const match = pickBestMatch(rows, name, threshold);
  return match ? { ...match, name: match.name || "(sans nom)" } : null;
}

/**
 * Cherche une tâche ouverte équivalente. Sert au dédup côté extraction :
 * si le LLM propose une action déjà tracée, on ne la re-propose pas.
 *
 * Scope :
 *  - `projectId` non null → tâches de ce projet **et** tâches sans projet
 *    (une action notée avant que le projet existe reste la même action).
 *  - `projectId` null → tâches sans projet, plus, si `anyProject` est vrai,
 *    toutes les autres. Sert au cas « le mail ne nomme pas de projet » :
 *    sans ça, une tâche déjà tracée sur un projet était re-proposée.
 *
 * Seuil bas par défaut (0.5) : on préfère skip une fois de trop — la tâche
 * existante reste visible, et l'humain peut toujours en créer une variante.
 */
export async function matchOpenTask(
  conn: Database,
  title: string,
  projectId: string | null,
  threshold: number = MATCH_THRESHOLD.task,
  opts?: { anyProject?: boolean },
): Promise<Match> {
  if (!normalizeNameKey(title)) return null;
  const scope =
    projectId !== null
      ? sql`(${tasks.projectId} = ${projectId} or ${tasks.projectId} is null)`
      : opts?.anyProject
        ? sql`true`
        : sql`${tasks.projectId} is null`;
  const rows = await conn
    .select({ id: tasks.id, name: tasks.title })
    .from(tasks)
    .where(sql`${scope} and ${tasks.status} not in ('done', 'cancelled')`)
    .limit(CANDIDATE_SCAN_LIMIT);
  return pickBestMatch(rows, title, threshold);
}
