import "server-only";

import { entities } from "@/db/schema/entities";
import { db } from "@/lib/db/server";
import type { ProjectKind } from "@/lib/schemas/projects";
import { sql } from "drizzle-orm";

/**
 * Nom de l'entité représentant Parade en interne (pour rattacher
 * automatiquement les projets `produit` et `transverse`). Lookup
 * insensible à la casse pour tolérer les variantes ("parade", "PARADE").
 */
const HOUSE_ENTITY_NAME = "Parade";

let _cachedHouseEntityId: { value: string | null; fetchedAt: number } | null = null;
const HOUSE_ENTITY_CACHE_MS = 60_000;

/**
 * Renvoie l'ID de l'entité « Parade » si elle existe (cache 1 min pour
 * éviter de spammer la DB sur chaque création de projet). `null` si
 * non trouvée — dans ce cas on laisse `entityId` à null.
 */
async function getHouseEntityId(): Promise<string | null> {
  const now = Date.now();
  if (_cachedHouseEntityId && now - _cachedHouseEntityId.fetchedAt < HOUSE_ENTITY_CACHE_MS) {
    return _cachedHouseEntityId.value;
  }
  const conn = await db();
  const [row] = await conn
    .select({ id: entities.id })
    .from(entities)
    .where(sql`lower(${entities.name}) = lower(${HOUSE_ENTITY_NAME})`)
    .limit(1);
  const value = row?.id ?? null;
  _cachedHouseEntityId = { value, fetchedAt: now };
  return value;
}

/**
 * Renvoie l'entityId par défaut à appliquer pour un projet selon son
 * `kind`. Les projets internes (`product`, `transverse`) sont rattachés
 * à Parade par défaut. Les projets `client` n'ont pas de default
 * (l'user choisit l'entité cliente).
 */
export async function getDefaultProjectEntityId(kind: ProjectKind): Promise<string | null> {
  if (kind === "product" || kind === "transverse") {
    return getHouseEntityId();
  }
  return null;
}

/** Pour les tests / CLI — invalide le cache forcé. */
export function _resetHouseEntityCache() {
  _cachedHouseEntityId = null;
}
