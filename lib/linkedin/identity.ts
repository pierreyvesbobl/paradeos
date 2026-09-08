/**
 * Normalisation des identifiants LinkedIn.
 *
 * Un DM LinkedIn n'a pas d'email — la seule clé de rapprochement solide
 * avec le CRM est le « public identifier », le slug de
 * `linkedin.com/in/<slug>`. Or `contacts.linkedin_url` est un champ
 * texte libre saisi à la main : on y trouve aussi bien
 * `https://www.linkedin.com/in/py-sage/` que `fr.linkedin.com/in/PY-Sage`
 * ou juste `py-sage`. D'où ce module, volontairement sans dépendance et
 * testable unitairement.
 */

/** Sous-domaines localisés que LinkedIn utilise (fr., www., m.…). */
const HOST_RE = /^(?:[a-z0-9-]+\.)*linkedin\.com$/i;

/**
 * Extrait le slug d'une URL de profil LinkedIn.
 *
 * Tolère : le protocole absent, n'importe quel sous-domaine, la casse,
 * le slash final, les paramètres de tracking, et une saisie qui serait
 * déjà le slug nu. Renvoie null si l'entrée n'est pas identifiable —
 * notamment pour une URL LinkedIn qui n'est pas un profil (`/company/…`,
 * `/feed/…`), qu'il ne faut surtout pas confondre avec un contact.
 */
export function normalizeLinkedinIdentifier(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;

  // Saisie sans protocole : `new URL` la refuserait.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    // Pas une URL du tout — on accepte un slug nu.
    return isPlausibleSlug(raw) ? raw.toLowerCase() : null;
  }

  if (!HOST_RE.test(url.hostname)) {
    // `py-sage` a été parsé comme un hostname : on retombe sur le slug nu.
    return isPlausibleSlug(raw) ? raw.toLowerCase() : null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const inIndex = segments.findIndex((s) => s.toLowerCase() === "in");
  const slug = inIndex >= 0 ? segments[inIndex + 1] : undefined;
  if (!slug) return null;

  // Le slug peut être percent-encodé (accents dans les noms).
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // Séquence d'échappement invalide : on garde la forme brute.
  }
  return isPlausibleSlug(decoded) ? decoded.toLowerCase() : null;
}

/**
 * Un slug plausible : pas d'espace, pas de slash, et pas un mot-clé de
 * navigation qui trahirait une URL non-profil.
 */
function isPlausibleSlug(value: string): boolean {
  if (!value || value.length > 200) return false;
  if (/[\s/?#]/.test(value)) return false;
  return !RESERVED_SLUGS.has(value.toLowerCase());
}

const RESERVED_SLUGS = new Set([
  "in",
  "company",
  "feed",
  "jobs",
  "messaging",
  "school",
  "showcase",
  "groups",
  "posts",
  "pulse",
]);

/**
 * Deux identifiants désignent-ils le même profil ? Comparaison
 * symétrique et tolérante, à utiliser plutôt que `===` sur des valeurs
 * brutes.
 */
export function sameLinkedinProfile(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeLinkedinIdentifier(a);
  const nb = normalizeLinkedinIdentifier(b);
  return na !== null && nb !== null && na === nb;
}

/** URL canonique de profil, pour l'affichage et le stockage. */
export function buildLinkedinProfileUrl(identifier: string | null | undefined): string | null {
  const slug = normalizeLinkedinIdentifier(identifier);
  return slug ? `https://www.linkedin.com/in/${slug}` : null;
}

/**
 * Extrait l'identifiant membre d'une URN Voyager
 * (`urn:li:fsd_profile:ACoAAA…` → `ACoAAA…`). Sert de clé de dédup
 * quand le slug est absent, LinkedIn ne l'exposant pas partout.
 */
export function memberIdFromUrn(urn: string | null | undefined): string | null {
  if (!urn) return null;
  const parts = urn.trim().split(":");
  const last = parts[parts.length - 1];
  return last && last !== urn ? last : null;
}
