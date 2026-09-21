/**
 * Map async avec plafond de concurrence. Module pur, sans dépendance :
 * utilisé partout où l'on tape en boucle sur un service externe qui
 * n'aimerait pas un `Promise.all` de cinquante appels d'un coup — Dougs
 * derrière Cloudflare, OpenRouter, Drive.
 *
 * L'ordre des résultats suit celui des entrées, pas celui des retours.
 */
export async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 5,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      const item = items[i];
      if (item === undefined) continue;
      results[i] = await fn(item, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
