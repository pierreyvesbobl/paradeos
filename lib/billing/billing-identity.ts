/**
 * Identité de facturation d'un client B2B : SIREN, SIRET, numéro de TVA.
 *
 * Objectif : qu'un devis ou une facture ne parte jamais vers Dougs sans
 * SIRET ni numéro de TVA quand on peut les connaître. La facture électronique
 * route sur le SIRET du destinataire, et le numéro de TVA intracommunautaire
 * est une mention obligatoire des factures B2B.
 *
 * Deux sources, dans cet ordre :
 *   1. le numéro de TVA français se **calcule** depuis le SIREN
 *      (clé = (12 + 3 × (SIREN mod 97)) mod 97) — aucun appel réseau ;
 *   2. le SIRET du siège s'obtient depuis l'annuaire des entreprises
 *      (Sirene), qui renvoie aussi le numéro de TVA officiel.
 *
 * Pure côté calcul, un seul appel réseau côté Sirene, jamais d'écriture :
 * c'est l'appelant qui décide de persister le résultat sur l'entité.
 */

import { searchCompanies } from "@/lib/gouv/sirene";

const SIREN_RE = /^\d{9}$/;
const SIRET_RE = /^\d{14}$/;

/** Chiffres seulement : « 911 556 421 » et « 911556421 » sont le même SIREN. */
export function normalizeSiren(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return SIREN_RE.test(digits) ? digits : null;
}

export function normalizeSiret(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return SIRET_RE.test(digits) ? digits : null;
}

/**
 * Numéro de TVA intracommunautaire français déduit du SIREN.
 *
 * `null` si le SIREN n'en est pas un. La clé est déterministe : on ne
 * « devine » rien, on applique la règle de la DGFiP. Les entreprises
 * non assujetties (franchise en base) ont quand même un numéro attribuable,
 * et Dougs l'affiche sans mention TVA quand le taux est nul.
 */
export function frenchVatNumberFromSiren(siren: string | null | undefined): string | null {
  const clean = normalizeSiren(siren);
  if (!clean) return null;
  const key = (12 + 3 * (Number(clean) % 97)) % 97;
  return `FR${String(key).padStart(2, "0")}${clean}`;
}

/** France métropolitaine et DROM : les deux écritures qu'on rencontre en base. */
function isFrench(country: string | null | undefined): boolean {
  const c = (country ?? "").trim().toLowerCase();
  return c === "" || c === "france" || c === "fr";
}

export type BillingIdentity = {
  siren: string | null;
  siret: string | null;
  vatNumber: string | null;
  /** Pays de l'adresse de facturation ; vide = France. */
  country?: string | null;
};

export type CompletedBillingIdentity = {
  siren: string | null;
  siret: string | null;
  vatNumber: string | null;
  /** Champs qu'on a complétés nous-mêmes, pour le dire à l'utilisateur. */
  derived: ("siret" | "vatNumber")[];
};

/**
 * Complète SIRET et numéro de TVA à partir du SIREN quand ils manquent.
 *
 * Ne touche jamais à une valeur déjà renseignée. Sans SIREN, il n'y a rien à
 * déduire : on rend l'entrée telle quelle. L'annuaire Sirene est interrogé
 * seulement s'il manque encore le SIRET après le calcul de la TVA, et son
 * échec (débit, panne) est avalé : une facture avec SIREN + TVA mais sans
 * SIRET vaut mieux qu'une facture pas poussée.
 */
export async function completeBillingIdentity(
  input: BillingIdentity,
  deps: { lookup?: typeof searchCompanies } = {},
): Promise<CompletedBillingIdentity> {
  const siren = normalizeSiren(input.siren);
  let siret = normalizeSiret(input.siret) ?? input.siret?.trim() ?? null;
  let vatNumber = input.vatNumber?.trim() || null;
  const derived: CompletedBillingIdentity["derived"] = [];

  if (!siren)
    return { siren: input.siren?.trim() || null, siret: siret || null, vatNumber, derived };

  // Un SIRET renseigné qui n'appartient pas à ce SIREN est une erreur de
  // saisie : on ne le propage pas à la facture, on le recalcule.
  if (siret && !siret.startsWith(siren)) {
    console.warn(`[billing-identity] SIRET ${siret} incohérent avec le SIREN ${siren}, ignoré`);
    siret = null;
  }

  if (!vatNumber && isFrench(input.country)) {
    vatNumber = frenchVatNumberFromSiren(siren);
    if (vatNumber) derived.push("vatNumber");
  }

  if (!siret) {
    const lookup = deps.lookup ?? searchCompanies;
    try {
      const companies = await lookup(siren, 3);
      const company = companies.find((c) => c.siren === siren);
      if (company?.siret && normalizeSiret(company.siret)) {
        siret = company.siret;
        derived.push("siret");
      }
      if (!vatNumber && company?.vatNumber) {
        vatNumber = company.vatNumber;
        derived.push("vatNumber");
      }
    } catch (err) {
      console.warn(
        `[billing-identity] annuaire indisponible pour le SIREN ${siren} :`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { siren, siret: siret || null, vatNumber, derived };
}

/**
 * Ce qui manque encore pour une facture B2B irréprochable, en phrases
 * destinées à l'utilisateur (toast UI, réponse MCP). Vide = rien à signaler.
 *
 * `clientData` est le payload tel qu'il part chez Dougs, après recherche
 * Dougs et complétion : on juge le document final, pas la fiche locale.
 */
export function billingIdentityWarnings(
  clientData: { isBToB?: unknown; siren?: unknown; siret?: unknown; vatNumber?: unknown },
  clientName: string,
): string[] {
  if (clientData.isBToB !== true) return [];
  const warnings: string[] = [];
  const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (!has(clientData.siren)) {
    warnings.push(
      `${clientName} : SIREN inconnu, la facture part sans identifiant d'entreprise. Complète la fiche entité (recherche annuaire) avant de finaliser.`,
    );
    return warnings;
  }
  if (!has(clientData.siret)) {
    warnings.push(`${clientName} : SIRET manquant sur la facture (annuaire injoignable ?).`);
  }
  if (!has(clientData.vatNumber)) {
    warnings.push(`${clientName} : numéro de TVA manquant sur la facture.`);
  }
  return warnings;
}
