/**
 * `fetch` avec timeout par AbortController. À utiliser pour tout appel
 * réseau exécuté dans un Server Component ou un Server Action : sans
 * borne, un upstream lent garde la fonction Vercel ouverte jusqu'à sa
 * limite globale (10–60 s) et fait "tourner la page dans le vide".
 *
 * En cas de timeout, lève une `Error` avec un message explicite — le
 * caller peut catch et afficher un message d'erreur localisé.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number; label?: string } = {},
): Promise<Response> {
  const { timeoutMs = 6000, label, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${label ?? "fetch"} : timeout (${timeoutMs}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
