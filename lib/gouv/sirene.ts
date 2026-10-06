import type { EntityAddress } from "@/db/schema/entities";
import { toFrenchTitleCase } from "@/lib/gouv/case";
import { fetchWithRetry } from "@/lib/net/fetch-with-retry";

/**
 * API Recherche d'entreprises (annuaire-entreprises.data.gouv.fr), adossée
 * à Sirene + RNE. Publique, sans clé, limitée en débit par IP — d'où le
 * debounce côté composant et `attempts: 2` ici.
 *
 * On ne retient que le siège : c'est l'adresse de facturation par défaut.
 * Le SIRET de l'établissement destinataire reste modifiable à la main,
 * la facture électronique pouvant viser un autre établissement.
 */
const SEARCH_URL = "https://recherche-entreprises.api.gouv.fr/search";

/**
 * Un établissement de l'entreprise. La facture électronique route sur le
 * SIRET du destinataire : facturer le siège quand la prestation concerne
 * une agence est une erreur d'adressage, pas un détail cosmétique.
 */
export type SireneEstablishment = {
  siret: string;
  /** Le siège, qu'on propose en premier et par défaut. */
  isHeadOffice: boolean;
  /** Enseigne ou nom commercial, quand l'établissement en porte un. */
  label: string | null;
  address: EntityAddress | null;
  addressLabel: string | null;
  active: boolean;
};

export type SireneCompany = {
  siren: string;
  /** SIRET du siège. */
  siret: string | null;
  /** Nom d'usage, celui qu'on affiche. */
  name: string;
  /** Dénomination sociale — celle qui doit figurer sur la facture. */
  legalName: string | null;
  vatNumber: string | null;
  address: EntityAddress | null;
  /** Adresse en une ligne, pour départager deux homonymes dans la liste. */
  addressLabel: string | null;
  /** `false` quand l'établissement est cessé : fiche à ne pas facturer. */
  active: boolean;
  /**
   * L'entreprise a demandé à ne pas être diffusée (statut_diffusion ≠ "O").
   * L'INSEE masque alors l'adresse : on le dit plutôt que d'afficher du vide.
   */
  undisclosed: boolean;
  /**
   * Siège en tête, puis les établissements que l'INSEE juge correspondre à
   * la recherche. Toujours au moins un élément quand le SIRET du siège est
   * connu — l'appelant ne propose un choix qu'au-delà de un.
   */
  establishments: SireneEstablishment[];
};

/** Forme partielle de la réponse : on ne déclare que ce qu'on lit. */
type ApiEtablissement = {
  siret?: string | null;
  etat_administratif?: string | null;
  statut_diffusion_etablissement?: string | null;
  numero_voie?: string | null;
  indice_repetition?: string | null;
  type_voie?: string | null;
  libelle_voie?: string | null;
  complement_adresse?: string | null;
  code_postal?: string | null;
  libelle_commune?: string | null;
  libelle_cedex?: string | null;
  cedex?: string | null;
  libelle_pays_etranger?: string | null;
  /** Présents sur `matching_etablissements` uniquement. */
  adresse?: string | null;
  est_siege?: boolean | null;
  liste_enseignes?: string[] | null;
  nom_commercial?: string | null;
};

type ApiResult = {
  siren?: string | null;
  nom_complet?: string | null;
  nom_raison_sociale?: string | null;
  tva?: string[] | null;
  siege?: ApiEtablissement | null;
  matching_etablissements?: ApiEtablissement[] | null;
};

/**
 * Les entreprises qui refusent la diffusion ne voient pas leurs champs
 * vidés : l'INSEE y met le littéral « [NON-DIFFUSIBLE] ». Le recopier
 * tel quel inscrirait « [Non-Diffusible] » en dénomination sociale et en
 * adresse. On le traite comme une absence de valeur, partout.
 */
const UNDISCLOSED_MARKERS = new Set(["[non-diffusible]", "[nd]"]);

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return UNDISCLOSED_MARKERS.has(trimmed.toLowerCase()) ? null : trimmed;
}

/** "17" + "B" + "RUE" + "DES CERISIERS" → "17 B Rue des Cerisiers". */
function buildStreet(siege: ApiEtablissement): string | null {
  const parts = [
    cleanText(siege.numero_voie),
    cleanText(siege.indice_repetition),
    cleanText(siege.type_voie),
    cleanText(siege.libelle_voie),
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return cleanText(siege.complement_adresse);

  const street = toFrenchTitleCase(parts.join(" "));
  const complement = cleanText(siege.complement_adresse);
  // Le complément ("BATIMENT C", "CHEZ X") précède la voie dans l'usage postal.
  return complement ? `${toFrenchTitleCase(complement)}, ${street}` : street;
}

function buildAddress(siege: ApiEtablissement | null | undefined): EntityAddress | null {
  if (!siege) return null;
  const street = buildStreet(siege);
  const postalCode = cleanText(siege.code_postal) ?? cleanText(siege.cedex);
  const cityRaw = cleanText(siege.libelle_commune) ?? cleanText(siege.libelle_cedex);
  const city = cityRaw ? toFrenchTitleCase(cityRaw) : null;
  const country = cleanText(siege.libelle_pays_etranger);

  const address: EntityAddress = {
    ...(street ? { street } : {}),
    ...(postalCode ? { postalCode } : {}),
    ...(city ? { city } : {}),
    // L'INSEE ne renseigne le pays que pour l'étranger : sans valeur, c'est la France.
    country: country ? toFrenchTitleCase(country) : "France",
  };
  return street || postalCode || city ? address : null;
}

function addressLabelOf(address: EntityAddress | null): string | null {
  if (!address) return null;
  const locality = [address.postalCode, address.city].filter(Boolean).join(" ");
  return [address.street, locality].filter(Boolean).join(", ") || null;
}

/**
 * `matching_etablissements` ne porte pas les champs de voie décomposés,
 * seulement l'adresse à plat ("17 RUE DOCTEUR BOUCHUT 69003 LYON"). On
 * retranche le suffixe "<code postal> <commune>" pour retrouver la voie,
 * et on garde l'adresse entière si le suffixe ne s'y trouve pas.
 */
function streetFromFlatAddress(etab: ApiEtablissement): string | null {
  const flat = cleanText(etab.adresse);
  if (!flat) return null;
  const suffix = [cleanText(etab.code_postal), cleanText(etab.libelle_commune)]
    .filter(Boolean)
    .join(" ");
  const street = suffix && flat.endsWith(suffix) ? flat.slice(0, -suffix.length) : flat;
  const trimmed = street.trim();
  return trimmed ? toFrenchTitleCase(trimmed) : null;
}

function matchingAddress(etab: ApiEtablissement): EntityAddress | null {
  const street = streetFromFlatAddress(etab);
  const postalCode = cleanText(etab.code_postal);
  const cityRaw = cleanText(etab.libelle_commune);
  const city = cityRaw ? toFrenchTitleCase(cityRaw) : null;
  if (!(street || postalCode || city)) return null;
  return {
    ...(street ? { street } : {}),
    ...(postalCode ? { postalCode } : {}),
    ...(city ? { city } : {}),
    country: "France",
  };
}

/** Siège d'abord, puis les établissements correspondants, sans doublon de SIRET. */
function buildEstablishments(
  result: ApiResult,
  siegeAddress: EntityAddress | null,
): SireneEstablishment[] {
  const list: SireneEstablishment[] = [];
  const seen = new Set<string>();

  const siegeSiret = cleanText(result.siege?.siret);
  if (siegeSiret) {
    seen.add(siegeSiret);
    list.push({
      siret: siegeSiret,
      isHeadOffice: true,
      label:
        cleanText(result.siege?.nom_commercial) ?? cleanText(result.siege?.liste_enseignes?.[0]),
      address: siegeAddress,
      addressLabel: addressLabelOf(siegeAddress),
      active: (result.siege?.etat_administratif ?? "A") === "A",
    });
  }

  for (const etab of result.matching_etablissements ?? []) {
    const siret = cleanText(etab.siret);
    if (!siret || seen.has(siret)) continue;
    seen.add(siret);
    const address = matchingAddress(etab);
    list.push({
      siret,
      isHeadOffice: etab.est_siege === true,
      label: cleanText(etab.nom_commercial) ?? cleanText(etab.liste_enseignes?.[0]),
      address,
      addressLabel: addressLabelOf(address),
      active: (etab.etat_administratif ?? "A") === "A",
    });
  }
  return list;
}

function normalize(result: ApiResult): SireneCompany | null {
  const siren = cleanText(result.siren);
  if (!siren) return null;

  const siege = result.siege ?? null;
  // `nom_complet` colle le sigle entre parenthèses ("BOBL (BOBL)") : la
  // dénomination sociale seule est plus propre. Repli sur `nom_complet`
  // pour les entreprises individuelles, qui n'ont pas de raison sociale.
  const name = cleanText(result.nom_raison_sociale) ?? cleanText(result.nom_complet) ?? siren;
  const legalName = cleanText(result.nom_raison_sociale);
  const address = buildAddress(siege);

  return {
    siren,
    siret: cleanText(siege?.siret),
    name: toFrenchTitleCase(name),
    legalName,
    vatNumber: cleanText(result.tva?.[0]),
    address,
    addressLabel: addressLabelOf(address),
    active: (siege?.etat_administratif ?? "A") === "A",
    undisclosed: (siege?.statut_diffusion_etablissement ?? "O") !== "O",
    establishments: buildEstablishments(result, address),
  };
}

/** Exporté pour les tests : la normalisation est la seule logique à vérifier. */
export function normalizeSireneResults(payload: unknown): SireneCompany[] {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((r) => normalize(r as ApiResult))
    .filter((c): c is SireneCompany => c !== null);
}

/**
 * Cherche une entreprise par nom, SIREN ou SIRET. Renvoie une liste vide
 * plutôt que de lever : un champ de recherche ne doit pas casser la saisie
 * parce que l'INSEE répond mal.
 */
export async function searchCompanies(query: string, limit = 8): Promise<SireneCompany[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("per_page", String(Math.min(Math.max(limit, 1), 25)));
  url.searchParams.set("page", "1");

  const res = await fetchWithRetry(url, {
    label: "recherche-entreprises",
    timeoutMs: 5000,
    attempts: 2,
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 429
        ? "L'annuaire des entreprises est momentanément saturé. Réessaie dans quelques secondes."
        : `L'annuaire des entreprises a répondu ${res.status}.`,
    );
  }
  return normalizeSireneResults(await res.json()).slice(0, limit);
}
