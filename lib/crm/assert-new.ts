import "server-only";

import {
  type ContactIdentity,
  fuzzyMatchContact,
  fuzzyMatchEntity,
  fuzzyMatchProject,
  isCertainMatch,
} from "@/lib/crm/match";
import { normalizeEmail } from "@/lib/crm/name-key";
import { findContactByEmail } from "@/lib/db/queries/contacts";
import { formatPersonName } from "@/lib/format";

/**
 * Garde-fou anti-doublon **à la saisie manuelle** (formulaires du CRM).
 *
 * Contrairement aux pipelines automatiques — qui lient silencieusement à
 * la fiche existante — on refuse la création et on dit laquelle existe
 * déjà. Une saisie est intentionnelle : si le nom tapé désigne une fiche
 * qu'on a déjà, l'humain doit choisir (ouvrir l'existante, ou nommer
 * autrement). C'est aussi la seule façon de ne pas faire silencieusement
 * autre chose que ce qui a été demandé.
 *
 * Le refus ne porte que sur les correspondances **certaines** (nom
 * strictement équivalent après normalisation, ou email identique). Une
 * simple ressemblance n'empêche rien : « Groupe Océa - Formation » doit
 * pouvoir coexister avec « Formation ».
 *
 * Les créations rapides depuis un picker FK (`quickCreate*`) ne passent
 * pas par ici : leur contrat est de rendre un id, donc elles réutilisent
 * la fiche existante (cf. `lib/crm/find-or-link.ts`).
 */

/** Lève si une entité équivalente existe déjà. */
export async function assertEntityIsNew(name: string): Promise<void> {
  const match = await fuzzyMatchEntity(name);
  if (match && isCertainMatch(match)) {
    throw new Error(
      `L'entité « ${match.name} » existe déjà. Ouvre sa fiche, ou choisis un autre nom.`,
    );
  }
}

/** Lève si un contact équivalent existe déjà : email exact, puis nom. */
export async function assertContactIsNew(identity: ContactIdentity): Promise<void> {
  const email = normalizeEmail(identity.email);
  if (email) {
    const byEmail = await findContactByEmail(email);
    if (byEmail) {
      throw new Error(
        `${formatPersonName(byEmail.firstName, byEmail.lastName)} utilise déjà ${email}. Ouvre sa fiche plutôt que d'en créer une seconde.`,
      );
    }
  }

  const match = await fuzzyMatchContact(identity.firstName ?? "", identity.lastName ?? "", {
    email: identity.email ?? null,
  });
  if (!match || !isCertainMatch(match)) return;
  // Nom strictement équivalent. Deux homonymes sont indiscernables sans
  // email, donc on refuse en indiquant la sortie : une adresse différente de
  // celle de la fiche existante fait passer la création (cf.
  // `pickBestContact`, qui n'est plus « certain » quand les emails se
  // contredisent).
  throw new Error(
    `Le contact « ${match.name} » existe déjà. Ouvre sa fiche pour la compléter — ou, s'il s'agit d'un homonyme, renseigne son email pour les distinguer.`,
  );
}

/**
 * Lève si l'adresse est déjà portée par **un autre** contact (en principale
 * ou en secondaire). Une adresse n'identifie qu'une personne : la laisser
 * sur deux fiches rendrait le rapprochement Gmail ambigu.
 */
export async function assertEmailFree(
  email: string,
  opts: { exceptContactId?: string } = {},
): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  const owner = await findContactByEmail(normalized);
  if (!owner || owner.id === opts.exceptContactId) return;
  throw new Error(
    `${formatPersonName(owner.firstName, owner.lastName)} utilise déjà ${normalized}. Une adresse n'appartient qu'à une fiche.`,
  );
}

/**
 * Lève si un projet équivalent existe déjà. Scopé sur l'entité quand elle
 * est connue : deux clients peuvent avoir chacun leur projet « Refonte
 * site », ce ne sont pas des doublons.
 */
export async function assertProjectIsNew(name: string, entityId?: string | null): Promise<void> {
  const match = await fuzzyMatchProject(
    name,
    entityId === undefined ? undefined : { entityId: entityId ?? null },
  );
  if (match && isCertainMatch(match)) {
    throw new Error(
      `Le projet « ${match.name} » existe déjà. Ouvre sa fiche, ou choisis un autre nom.`,
    );
  }
}
