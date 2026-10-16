import "server-only";

/**
 * Construction du payload client Dougs et création d'un brouillon de facture
 * de vente, partagées par tous les chemins de push.
 *
 * Avant, cette logique était copiée-collée cinq fois (devis projet, jalon
 * projet, facture coworking, plus les deux handlers MCP) et les copies
 * divergeaient déjà : seule la version coworking faisait un merge champ par
 * champ de l'adresse, les autres prenaient le résultat Dougs en bloc et
 * écrasaient la rue avec une chaîne vide. C'est la variante coworking qui est
 * conservée ici.
 */

import { eq, sql } from "drizzle-orm";
import { type EntityAddress, entities } from "@/db/schema/entities";
import { db } from "@/lib/db/server";
import {
  createDougsSalesInvoiceDraft,
  DougsApiError,
  DougsAuthError,
  dougsFileExists,
  searchDougsClients,
  updateDougsSalesInvoice,
} from "@/lib/dougs/client";
import { completeBillingIdentity, normalizeSiren } from "./billing-identity";
import type { DocumentOverrides } from "./brand-templates";
import { buildDocumentPatch } from "./dougs-document";
import type { DougsInvoiceLine } from "./dougs-lines";

export { buildDocumentPatch, buildDraftUpdatePayload, type DraftEdit } from "./dougs-document";

/**
 * Retire le logo s'il n'existe plus chez Dougs : le document prend alors le
 * logo par défaut de la société au lieu d'une image cassée. Voir
 * `DocumentOverrides.logoUuid` pour la raison.
 */
export async function withVerifiedLogo<T extends DocumentOverrides | undefined>(
  userId: string,
  ov: T,
): Promise<T> {
  if (!ov?.logoUuid) return ov;
  if (await dougsFileExists(userId, ov.logoUuid)) return ov;
  console.warn(`[dougs] logo ${ov.logoUuid} introuvable chez Dougs, logo par défaut appliqué`);
  const { logoUuid: _dead, ...rest } = ov;
  return rest as T;
}

/** Adresse au format attendu par Dougs (`zipCode` camelCase dans le payload). */
type DougsAddress = { street: string; zipCode: string; city: string; country: string };

/** Vide ou blanc = absent. `??` ne rattrape pas la chaîne vide. */
function orEmpty(v: string | null | undefined): string {
  return v?.trim() ?? "";
}

function toDougsAddress(addr: EntityAddress | null | undefined): DougsAddress {
  return {
    street: orEmpty(addr?.street),
    zipCode: orEmpty(addr?.postalCode),
    city: orEmpty(addr?.city),
    // Le pays doit toujours valoir quelque chose : une adresse sans pays fait
    // refuser la finalisation par Dougs (« Vous devez renseigner l'adresse du
    // client »), et un champ saisi puis vidé vaut `""`, pas `null` — que `??`
    // laisserait passer tel quel.
    country: orEmpty(addr?.country) || "France",
  };
}

const EMPTY_ADDRESS: DougsAddress = { street: "", zipCode: "", city: "", country: "" };

/** Identité telle que Parade OS la connaît, avant confrontation avec Dougs. */
export type LocalClientIdentity = {
  /**
   * Fiche entité d'origine. Quand elle est connue, le SIRET et le numéro de
   * TVA déduits de **son** SIREN lui sont réécrits : la prochaine facture
   * n'aura plus rien à chercher et le CRM s'enrichit au passage.
   */
  entityId?: string | null;
  /** Dénomination sociale (B2B). */
  legalName?: string | null;
  siren?: string | null;
  siret?: string | null;
  vatNumber?: string | null;
  /** Prénom / nom (B2C). */
  firstName?: string | null;
  lastName?: string | null;
  address?: EntityAddress | null;
  deliveryAddress?: EntityAddress | null;
  email?: string | null;
};

/**
 * Réécrit sur l'entité les identifiants qu'on vient de déduire, sans jamais
 * écraser une valeur saisie. Échec silencieux : la facture ne doit pas
 * attendre le CRM.
 */
async function persistDerivedIdentity(
  entityId: string,
  derived: { siret: string | null; vatNumber: string | null },
): Promise<void> {
  if (!derived.siret && !derived.vatNumber) return;
  try {
    const conn = await db();
    await conn
      .update(entities)
      .set({
        siret: sql`coalesce(${entities.siret}, ${derived.siret})`,
        vatNumber: sql`coalesce(${entities.vatNumber}, ${derived.vatNumber})`,
        updatedAt: new Date(),
      })
      .where(eq(entities.id, entityId));
  } catch (err) {
    console.warn(
      `[dougs] identité déduite non enregistrée sur l'entité ${entityId} :`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Dernière passe sur un `clientData` B2B : complète SIRET et numéro de TVA
 * depuis le SIREN retenu (calcul de la clé TVA, SIRET du siège via
 * l'annuaire), puis mémorise le résultat sur l'entité quand ce SIREN est bien
 * celui de sa fiche — pas celui d'un homonyme remonté par la recherche Dougs.
 */
async function withCompletedIdentity(
  clientData: Record<string, unknown>,
  local: LocalClientIdentity,
  country: string,
): Promise<Record<string, unknown>> {
  if (clientData.isBToB !== true) return clientData;
  const completed = await completeBillingIdentity({
    siren: clientData.siren as string | null,
    siret: clientData.siret as string | null,
    vatNumber: clientData.vatNumber as string | null,
    country,
  });
  const out = { ...clientData, siret: completed.siret, vatNumber: completed.vatNumber };
  const ownSiren = normalizeSiren(local.siren);
  if (local.entityId && ownSiren && ownSiren === completed.siren && completed.derived.length) {
    await persistDerivedIdentity(local.entityId, {
      siret: completed.derived.includes("siret") ? completed.siret : null,
      vatNumber: completed.derived.includes("vatNumber") ? completed.vatNumber : null,
    });
  }
  return out;
}

/**
 * Résout le `clientData` d'une facture Dougs : recherche le client côté Dougs
 * (qui interroge aussi Pappers/INSEE) puis fusionne **champ par champ** avec
 * ce qu'on connaît localement, Dougs prioritaire quand il est non vide, et
 * complète enfin SIRET + TVA depuis le SIREN (cf. `withCompletedIdentity`).
 *
 * Le merge champ par champ n'est pas un détail : l'endpoint de recherche
 * renvoie souvent la ville et le code postal mais pas la rue. Prendre le
 * résultat en bloc écraserait la rue saisie dans Parade OS par `""`, et la
 * facture partirait avec une adresse incomplète — ce que `can-finalize`
 * refuse, à juste titre.
 *
 * Remonte les erreurs Dougs en `Error` lisible, sauf `DougsAuthError` qu'on
 * laisse filer : l'appelant doit pouvoir distinguer « cookie expiré » du reste.
 */
export async function resolveDougsClientData(args: {
  userId: string;
  isBtoB: boolean;
  /** Nom utilisé pour la recherche Dougs. */
  searchName: string;
  local: LocalClientIdentity;
}): Promise<Record<string, unknown>> {
  const { userId, isBtoB, searchName, local } = args;
  const localAddress = toDougsAddress(local.address);
  // Dougs attend toujours la clé : quatre chaînes vides quand on n'a rien,
  // ce qui lui signifie « identique à l'adresse de facturation ».
  const deliveryAddress = local.deliveryAddress
    ? toDougsAddress(local.deliveryAddress)
    : EMPTY_ADDRESS;

  let best: Awaited<ReturnType<typeof searchDougsClients>>[number] | undefined;
  try {
    const matches = await searchDougsClients(userId, searchName, isBtoB);
    best = matches[0];
  } catch (err) {
    if (err instanceof DougsAuthError) throw err;
    if (err instanceof DougsApiError) {
      throw new Error(`Recherche client Dougs : ${err.message}`);
    }
    throw err;
  }

  if (!best) {
    return withCompletedIdentity(
      {
        isBToB: isBtoB,
        legalName: isBtoB ? (local.legalName ?? null) : null,
        siren: local.siren ?? null,
        siret: local.siret ?? null,
        vatNumber: local.vatNumber ?? null,
        firstName: isBtoB ? null : (local.firstName ?? null),
        lastName: isBtoB ? null : (local.lastName ?? null),
        address: localAddress,
        deliveryAddress,
        others: [],
        email: local.email ?? null,
        phone: null,
        clientId: null,
      },
      local,
      localAddress.country,
    );
  }

  return withCompletedIdentity(
    {
      isBToB: best.isBtoB,
      legalName: best.legalName ?? best.name ?? local.legalName ?? null,
      siren: best.siren || (local.siren ?? null),
      // Dougs ne renvoie pas le SIRET dans sa recherche : c'est toujours le
      // nôtre qui fait foi. Historiquement envoyé en `null` en dur, ce qui
      // privait la facture de l'identifiant d'établissement.
      siret: local.siret ?? null,
      vatNumber: best.vatNumber || (local.vatNumber ?? null),
      firstName: best.firstName ?? local.firstName ?? null,
      lastName: best.lastName ?? local.lastName ?? null,
      address: {
        street: best.address?.street || localAddress.street,
        zipCode: best.address?.zipcode || localAddress.zipCode,
        city: best.address?.city || localAddress.city,
        country: localAddress.country,
      },
      deliveryAddress,
      others: [],
      email: best.email ?? local.email ?? null,
      phone: best.phone ?? null,
      clientId: best.clientId,
    },
    local,
    localAddress.country,
  );
}

/**
 * Crée un brouillon de facture de vente et y pose client + lignes.
 *
 * Le spread du draft est obligatoire : la réponse de `createDraft` contient
 * déjà `invoicerOthers`, `legalData`, `date`, `numberPrefix` et `number`,
 * c'est-à-dire les mentions légales et la numérotation remplies par Dougs.
 * Ne pas les renvoyer les efface.
 */
export async function pushDougsSalesInvoiceDraft(args: {
  userId: string;
  clientData: Record<string, unknown>;
  lines: DougsInvoiceLine[];
  /** Objet de la facture, affiché en tête du document. */
  subject?: string | null;
  /** Mentions que la marque impose au document. */
  document?: DocumentOverrides;
}): Promise<{ id: string; reference: string }> {
  try {
    const document = await withVerifiedLogo(args.userId, args.document);
    const draft = await createDougsSalesInvoiceDraft(args.userId);
    await updateDougsSalesInvoice(args.userId, draft.id, {
      ...draft,
      ...(args.subject ? { subject: args.subject } : {}),
      ...buildDocumentPatch(draft, document),
      clientData: args.clientData,
      lines: args.lines,
    });
    return { id: draft.id, reference: draft.reference };
  } catch (err) {
    if (err instanceof DougsAuthError) throw err;
    if (err instanceof DougsApiError) {
      throw new Error(`Push Dougs : ${err.message}`);
    }
    throw err;
  }
}
