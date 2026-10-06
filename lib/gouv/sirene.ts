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
};

type ApiResult = {
  siren?: string | null;
  nom_complet?: string | null;
  nom_raison_sociale?: string | null;
  tva?: string[] | null;
  siege?: ApiEtablissement | null;
};

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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
    addressLabel: address
      ? [address.street, [address.postalCode, address.city].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", ")
      : null,
    active: (siege?.etat_administratif ?? "A") === "A",
    undisclosed: (siege?.statut_diffusion_etablissement ?? "O") !== "O",
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
