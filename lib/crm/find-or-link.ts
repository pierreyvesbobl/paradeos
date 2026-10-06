import "server-only";

import {
  type ContactIdentity,
  fuzzyMatchContact,
  fuzzyMatchEntity,
  fuzzyMatchProject,
  fuzzyMatchTaskInProject,
  type Match,
} from "@/lib/crm/match";

/**
 * Re-vérification juste avant création, au moment où une proposition est
 * acceptée.
 *
 * Pourquoi c'est indispensable : le `matchedId` d'une proposition est figé
 * **à l'extraction**. Deux mails extraits le matin peuvent proposer la même
 * société inconnue avec `matchedId = null` ; accepter le premier la crée,
 * et le second n'a aucune raison de savoir qu'elle existe désormais. C'est
 * l'enchaînement qui a produit « MKP Doctor » puis « mkpdoctor » à 25
 * secondes d'intervalle. Le garde-fou historique — un `ilike` sur le nom
 * exact — ne voyait ni la casse collée, ni la forme juridique, ni un
 * accent.
 *
 * On rejoue donc les matchers au moment de l'acceptation, mais **seulement
 * sur les correspondances certaines** (`confidence >= 1` : email identique,
 * ou nom strictement équivalent après normalisation). Accepter une
 * proposition est un geste explicite — « crée ça » — et le rapprochement
 * approximatif a déjà été montré à l'humain à l'extraction, dans « Déjà en
 * base ». Lier en silence sur un score de 0.65 fusionnerait au passage des
 * objets légitimement distincts (« Formation » et « Groupe Océa -
 * Formation » se ressemblent à 0.667).
 */

/** Ne retient qu'un rapprochement sûr : cf. commentaire ci-dessus. */
function certain(match: Match): Match {
  return match !== null && match.confidence >= 1 ? match : null;
}

/** Entité existante équivalente, ou null. */
export async function findExistingEntityId(name: string): Promise<string | null> {
  const match = certain(await fuzzyMatchEntity(name));
  if (match) {
    console.info(
      `[dédup] entité « ${name} » non créée : liée à « ${match.name} » (confiance ${match.confidence.toFixed(2)}).`,
    );
  }
  return match?.id ?? null;
}

/** Contact existant équivalent, ou null. L'email primme sur le nom. */
export async function findExistingContactId(identity: ContactIdentity): Promise<string | null> {
  const firstName = identity.firstName ?? "";
  const lastName = identity.lastName ?? "";
  const match = certain(
    await fuzzyMatchContact(firstName, lastName, { email: identity.email ?? null }),
  );
  if (match) {
    console.info(
      `[dédup] contact « ${firstName} ${lastName} » non créé : lié à « ${match.name} » (confiance ${match.confidence.toFixed(2)}).`,
    );
  }
  return match?.id ?? null;
}

/**
 * Projet existant équivalent, ou null. `entityId` scope la recherche quand
 * on le connaît : deux projets d'un même client partagent leur préfixe et
 * se ressemblent beaucoup trop sans ce scope.
 */
export async function findExistingProjectId(
  name: string,
  entityId?: string | null,
): Promise<string | null> {
  const match = certain(
    await fuzzyMatchProject(
      name,
      entityId === undefined ? undefined : { entityId: entityId ?? null },
    ),
  );
  if (match) {
    console.info(
      `[dédup] projet « ${name} » non créé : lié à « ${match.name} » (confiance ${match.confidence.toFixed(2)}).`,
    );
  }
  return match?.id ?? null;
}

/**
 * Tâche ouverte équivalente sur le projet cible, ou null. Accepter deux
 * fois la même action (depuis deux mails d'un fil, par exemple) ne doit
 * pas donner deux lignes à faire.
 */
export async function findExistingOpenTaskId(
  title: string,
  projectId: string | null,
): Promise<string | null> {
  const match = certain(
    await fuzzyMatchTaskInProject(title, projectId, undefined, {
      anyProject: projectId === null,
    }),
  );
  if (match) {
    console.info(`[dédup] tâche « ${title} » non créée : « ${match.name} » est déjà ouverte.`);
  }
  return match?.id ?? null;
}
