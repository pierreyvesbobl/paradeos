import { createHash, timingSafeEqual } from "node:crypto";

/**
 * PKCE (RFC 7636), méthode S256 uniquement — OAuth 2.1 retire `plain`.
 * Isolé dans son propre module (sans `server-only` ni accès base) pour
 * rester testable unitairement : c'est la primitive qui empêche
 * l'interception d'un code d'autorisation.
 */
export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Le challenge attendu pour un verifier donné — utilisé côté client et en test. */
export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
