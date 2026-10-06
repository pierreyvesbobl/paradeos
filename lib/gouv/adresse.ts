import type { EntityAddress } from "@/db/schema/entities";
import { fetchWithRetry } from "@/lib/net/fetch-with-retry";

/**
 * Base Adresse Nationale (api-adresse.data.gouv.fr). Publique, sans clé.
 * Elle ne *trouve* pas une adresse à partir d'un nom — elle normalise ce
 * qui est tapé. Les libellés en sortent déjà correctement capitalisés,
 * contrairement à l'INSEE : pas de retouche ici.
 */
const SEARCH_URL = "https://api-adresse.data.gouv.fr/search/";

export type AddressSuggestion = {
  /** Identifiant BAN, utilisé comme clé de liste. */
  id: string;
  /** "17 Impasse des cerisiers 69250 Fleurieu-sur-Saône". */
  label: string;
  /** Contexte départemental, pour départager deux voies homonymes. */
  context: string | null;
  address: EntityAddress;
};

type ApiFeature = {
  properties?: {
    id?: string | null;
    label?: string | null;
    context?: string | null;
    housenumber?: string | null;
    street?: string | null;
    name?: string | null;
    postcode?: string | null;
    city?: string | null;
    type?: string | null;
  } | null;
};

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalize(feature: ApiFeature, index: number): AddressSuggestion | null {
  const p = feature.properties;
  if (!p) return null;
  const label = cleanText(p.label);
  if (!label) return null;

  // `name` contient déjà "17 Impasse des cerisiers" pour un type
  // "housenumber" ; street/housenumber servent de repli. Sur un type
  // "municipality", `name` vaut le nom de la commune : le verser dans le
  // champ Rue donnerait "Lyon 7e Arrondissement" en guise d'adresse.
  const isStreetLevel = p.type !== "municipality";
  const fallback = [cleanText(p.housenumber), cleanText(p.street)].filter(Boolean).join(" ");
  const street = isStreetLevel ? (cleanText(p.name) ?? cleanText(fallback)) : null;

  return {
    id: cleanText(p.id) ?? `${label}-${index}`,
    label,
    context: cleanText(p.context),
    address: {
      ...(street ? { street } : {}),
      ...(cleanText(p.postcode) ? { postalCode: p.postcode as string } : {}),
      ...(cleanText(p.city) ? { city: p.city as string } : {}),
      country: "France",
    },
  };
}

/** Exporté pour les tests. */
export function normalizeAddressResults(payload: unknown): AddressSuggestion[] {
  const features = (payload as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  return features
    .map((f, i) => normalize(f as ApiFeature, i))
    .filter((a): a is AddressSuggestion => a !== null);
}

export async function searchAddresses(query: string, limit = 6): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 4) return [];

  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 15)));
  // Hors "housenumber"/"street", la BAN renvoie des communes et lieux-dits :
  // utiles quand l'adresse se résume à une ville.
  url.searchParams.set("autocomplete", "1");

  const res = await fetchWithRetry(url, {
    label: "api-adresse",
    timeoutMs: 5000,
    attempts: 2,
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      res.status === 429
        ? "La Base Adresse Nationale est momentanément saturée. Réessaie dans quelques secondes."
        : `La Base Adresse Nationale a répondu ${res.status}.`,
    );
  }
  return normalizeAddressResults(await res.json());
}
