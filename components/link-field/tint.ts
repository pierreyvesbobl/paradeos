/**
 * Famille de tint déterministe pour un libellé. Conforme à la spec
 * "champ de liaison" (handoff design) : 9 familles catégorielles, le hash
 * du nom garantit qu'un même record retombe toujours sur la même couleur.
 *
 * Volontairement séparé de `lib/demo/anonymize` car cette logique sert un
 * usage visuel (avatar coloré) et non d'anonymisation.
 */

export const TINT_FAMILIES = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "mauve",
  "pink",
  "red",
] as const;

export type TintFamily = (typeof TINT_FAMILIES)[number];

/** djb2 — stable, suffisant pour 9 buckets. */
function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return h >>> 0;
}

export function tintFor(seed: string): TintFamily {
  const idx = hash(seed.toLowerCase()) % TINT_FAMILIES.length;
  return TINT_FAMILIES[idx] as TintFamily;
}

/**
 * Map static des classes Tailwind par famille — l'interpolation dynamique
 * `bg-tint-${family}-bg` n'est pas détectable par le JIT, donc on liste.
 */
export const TINT_CLASSES: Record<TintFamily, { bg: string; text: string; dot: string }> = {
  gray: { bg: "bg-tint-gray-bg", text: "text-tint-gray-text", dot: "text-tint-gray-dot" },
  brown: { bg: "bg-tint-brown-bg", text: "text-tint-brown-text", dot: "text-tint-brown-dot" },
  orange: { bg: "bg-tint-orange-bg", text: "text-tint-orange-text", dot: "text-tint-orange-dot" },
  yellow: { bg: "bg-tint-yellow-bg", text: "text-tint-yellow-text", dot: "text-tint-yellow-dot" },
  green: { bg: "bg-tint-green-bg", text: "text-tint-green-text", dot: "text-tint-green-dot" },
  blue: { bg: "bg-tint-blue-bg", text: "text-tint-blue-text", dot: "text-tint-blue-dot" },
  mauve: { bg: "bg-tint-mauve-bg", text: "text-tint-mauve-text", dot: "text-tint-mauve-dot" },
  pink: { bg: "bg-tint-pink-bg", text: "text-tint-pink-text", dot: "text-tint-pink-dot" },
  red: { bg: "bg-tint-red-bg", text: "text-tint-red-text", dot: "text-tint-red-dot" },
};

export function initialsFrom(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() ?? "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts[parts.length - 1]?.[0] ?? "";
  return (first + last).toUpperCase();
}
