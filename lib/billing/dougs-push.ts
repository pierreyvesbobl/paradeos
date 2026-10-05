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

import type { EntityAddress } from "@/db/schema/entities";
import {
  DougsApiError,
  DougsAuthError,
  createDougsSalesInvoiceDraft,
  searchDougsClients,
  updateDougsSalesInvoice,
} from "@/lib/dougs/client";
import type { DocumentOverrides } from "./brand-templates";
import type { DougsInvoiceLine } from "./dougs-lines";

/**
 * Construit le patch des mentions du document, en **fusionnant** avec ce que
 * Dougs a déjà posé sur le brouillon.
 *
 * La fusion clé par clé n'est pas cosmétique : `legalData` porte l'IBAN et les
 * pénalités de retard, `footerData` porte l'identité légale complète (SIRET,
 * RCS, capital, TVA). Remplacer ces objets en bloc effacerait des mentions
 * obligatoires de la facture.
 */
export function buildDocumentPatch(
  draft: Record<string, unknown>,
  ov: DocumentOverrides | undefined,
): Record<string, unknown> {
  if (!ov || Object.keys(ov).length === 0) return {};
  const patch: Record<string, unknown> = {};

  if (ov.invoicerOthers !== undefined) patch.invoicerOthers = ov.invoicerOthers;
  if (ov.thankYouNote !== undefined) patch.thankYouNote = ov.thankYouNote;
  if (ov.dueDateOption !== undefined) patch.dueDateOption = ov.dueDateOption;
  if (ov.logoUuid !== undefined) patch.logoUuid = ov.logoUuid;

  if (ov.paymentTerms !== undefined || ov.latePaymentTerms !== undefined) {
    const current = (draft.legalData ?? {}) as Record<string, unknown>;
    patch.legalData = {
      ...current,
      ...(ov.paymentTerms !== undefined ? { paymentTerms: ov.paymentTerms } : {}),
      ...(ov.latePaymentTerms !== undefined ? { latePaymentTerms: ov.latePaymentTerms } : {}),
    };
  }

  if (ov.footerOthers !== undefined) {
    const current = (draft.footerData ?? {}) as Record<string, unknown>;
    patch.footerData = { ...current, others: ov.footerOthers };
  }

  return patch;
}

/** Adresse au format attendu par Dougs (`zipCode` camelCase dans le payload). */
type DougsAddress = { street: string; zipCode: string; city: string; country: string };

function toDougsAddress(addr: EntityAddress | null | undefined): DougsAddress {
  return {
    street: addr?.street ?? "",
    zipCode: addr?.postalCode ?? "",
    city: addr?.city ?? "",
    country: addr?.country ?? "France",
  };
}

const EMPTY_ADDRESS: DougsAddress = { street: "", zipCode: "", city: "", country: "" };

/** Identité telle que Parade OS la connaît, avant confrontation avec Dougs. */
export type LocalClientIdentity = {
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
 * Résout le `clientData` d'une facture Dougs : recherche le client côté Dougs
 * (qui interroge aussi Pappers/INSEE) puis fusionne **champ par champ** avec
 * ce qu'on connaît localement, Dougs prioritaire quand il est non vide.
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
    return {
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
    };
  }

  return {
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
  };
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
    const draft = await createDougsSalesInvoiceDraft(args.userId);
    await updateDougsSalesInvoice(args.userId, draft.id, {
      ...draft,
      ...(args.subject ? { subject: args.subject } : {}),
      ...buildDocumentPatch(draft, args.document),
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
