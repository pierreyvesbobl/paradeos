import { fetchWithTimeout } from "@/lib/net/fetch-with-timeout";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export type FetchWithRetryInit = RequestInit & {
  timeoutMs?: number;
  label?: string;
  /** Tentatives au total (1 = pas de retry). Défaut 3. */
  attempts?: number;
  /** Base du backoff exponentiel en ms. Défaut 500. */
  baseDelayMs?: number;
  /**
   * Par défaut seules les requêtes GET/HEAD sont rejouées : un POST non
   * idempotent rejoué après un 502 pourrait créer un doublon. Mettre
   * `true` quand l'appelant sait que la requête est idempotente.
   */
  retryNonIdempotent?: boolean;
  /** Injectable pour les tests. */
  sleep?: (ms: number) => Promise<void>;
};

function delayFor(attempt: number, base: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.min(Math.max(at - Date.now(), 0), 30_000);
  }
  const exp = base * 2 ** attempt;
  return exp + Math.floor(Math.random() * base);
}

/**
 * `fetchWithTimeout` + rejeu borné sur 429/5xx et erreurs réseau, avec
 * backoff exponentiel et respect de `Retry-After`. Les 4xx (hors 429)
 * ne sont jamais rejoués : ils ne changeront pas.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: FetchWithRetryInit = {},
): Promise<Response> {
  const {
    attempts = 3,
    baseDelayMs = 500,
    retryNonIdempotent = false,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    ...rest
  } = init;
  const method = (rest.method ?? "GET").toUpperCase();
  const canRetry = retryNonIdempotent || method === "GET" || method === "HEAD";
  const maxAttempts = canRetry ? Math.max(1, attempts) : 1;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(input, rest);
      if (!RETRYABLE_STATUS.has(res.status) || attempt === maxAttempts - 1) return res;
      await sleep(delayFor(attempt, baseDelayMs, res.headers.get("retry-after")));
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts - 1) throw err;
      await sleep(delayFor(attempt, baseDelayMs, null));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("fetchWithRetry : échec");
}
