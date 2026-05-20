/**
 * Extrait le domaine d'une URL website (entité). Utilisé pour matcher
 * un email entrant (`from_email`) à une entité connue.
 *
 *   extractDomain("https://www.example.com/path") → "example.com"
 *   extractDomain("example.com")                   → "example.com"
 *   extractDomain(null)                            → null
 */
export function extractDomain(websiteUrl: string | null | undefined): string | null {
  if (!websiteUrl) return null;
  const trimmed = websiteUrl.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withProtocol);
    return u.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Domaine d'une adresse email — partie après le `@`. */
export function domainFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/**
 * Liste des domaines "génériques" qu'il ne faut pas utiliser pour matcher
 * une entité — sinon n'importe quel email Gmail/Outlook serait rattaché
 * à n'importe quelle entité ayant un de ces fournisseurs comme website
 * (improbable mais on protège).
 */
export const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "yahoo.fr",
  "icloud.com",
  "me.com",
  "live.com",
  "proton.me",
  "protonmail.com",
  "free.fr",
  "orange.fr",
  "laposte.net",
  "wanadoo.fr",
  "sfr.fr",
  "bbox.fr",
]);
