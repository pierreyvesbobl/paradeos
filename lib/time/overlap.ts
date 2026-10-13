/**
 * Répartition des minutes entre créneaux qui se chevauchent.
 *
 * Deux sessions Claude Code ouvertes en parallèle sur deux projets écrivent
 * deux segments qui se recouvrent. Une minute de travail ne doit compter
 * qu'une fois : chaque minute commune est partagée à parts égales entre
 * les segments actifs à cet instant (règle « chaque minute compte une
 * fois, partagée »). Les chevauchements ne se calculent qu'au sein d'un
 * même utilisateur — l'appelant groupe avant.
 */
export type OverlapEntry = {
  id: string;
  startMs: number;
  endMs: number;
};

/** Minutes créditées à chaque entrée, après partage des recouvrements. */
export function creditOverlaps(entries: readonly OverlapEntry[]): Map<string, number> {
  const credited = new Map<string, number>();
  for (const e of entries) credited.set(e.id, 0);
  if (entries.length === 0) return credited;

  const bounds = new Set<number>();
  for (const e of entries) {
    bounds.add(e.startMs);
    bounds.add(e.endMs);
  }
  const sorted = [...bounds].sort((a, b) => a - b);

  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i] as number;
    const to = sorted[i + 1] as number;
    if (to <= from) continue;
    const active = entries.filter((e) => e.startMs <= from && e.endMs >= to);
    if (active.length === 0) continue;
    const share = (to - from) / 60_000 / active.length;
    for (const e of active) credited.set(e.id, (credited.get(e.id) ?? 0) + share);
  }
  return credited;
}

/** Minutes brutes d'une entrée, sans partage. */
export function rawMinutes(e: OverlapEntry): number {
  return Math.max(0, (e.endMs - e.startMs) / 60_000);
}
