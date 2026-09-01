const eurFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatEuro(value: number): string {
  return eurFormatter.format(value);
}

export function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return dateFormatter.format(date);
}

export function formatDateTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return dateTimeFormatter.format(date);
}

/** "1h30", "45min", "8h", "0h". Format compact FR pour les durées. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total === 0) return "0h";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

/**
 * Temps relatif court à la Notion : « à l'instant », « il y a 12 min »,
 * « il y a 2 h », « hier », « il y a 3 j », « il y a 2 sem. »,
 * « il y a 4 mois », « il y a 2 ans ». Toujours au passé.
 */
export function formatRelativeShort(value: Date | string, now: Date = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.max(0, Math.round(diffMs / 1000));
  if (diffSec < 45) return "à l'instant";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `il y a ${diffHour} h`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay === 1) return "hier";
  if (diffDay < 7) return `il y a ${diffDay} j`;
  const diffWeek = Math.round(diffDay / 7);
  if (diffWeek < 5) return `il y a ${diffWeek} sem.`;
  const diffMonth = Math.round(diffDay / 30);
  if (diffMonth < 12) return `il y a ${diffMonth} mois`;
  const diffYear = Math.round(diffDay / 365);
  return `il y a ${diffYear} an${diffYear > 1 ? "s" : ""}`;
}

/** "0,5 j", "1 j", "12,5 j". Nombre de jours-hommes avec suffixe FR. */
export function formatDays(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "0 j";
  const rounded = Math.round(days * 10) / 10;
  const formatted = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace(".", ",");
  return `${formatted} j`;
}

/**
 * Une valeur de nom est "absente" si elle est nulle, vide, ou porte une
 * des chaînes-poubelles qu'on retrouve en base : `"null"` /
 * `"undefined"` viennent d'un `String(x)` sur une valeur manquante,
 * quelque part entre une extraction IA et un import.
 */
function presentName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (lower === "null" || lower === "undefined") return null;
  return v;
}

/**
 * Nom affichable d'une personne à partir d'un prénom et d'un nom, dont
 * l'un ou l'autre peut manquer.
 *
 * À utiliser partout plutôt que `` `${firstName} ${lastName}` ``, qui
 * produit « Frédéric null » dès qu'un des deux champs manque — `.trim()`
 * ne rattrape pas le cas, il n'enlève que les espaces de bord.
 *
 * Renvoie `fallback` (par défaut « Sans nom ») si les deux manquent, de
 * sorte qu'un appelant puisse toujours afficher le résultat tel quel.
 */
export function formatPersonName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallback = "Sans nom",
): string {
  const parts = [presentName(firstName), presentName(lastName)].filter(
    (p): p is string => p !== null,
  );
  return parts.length > 0 ? parts.join(" ") : fallback;
}

/**
 * Variante qui renvoie `null` plutôt qu'un libellé de repli, pour les
 * appelants qui veulent décider eux-mêmes quoi afficher (ou qui s'en
 * servent comme clé de recherche / de matching).
 */
export function personNameOrNull(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  const name = formatPersonName(firstName, lastName, "");
  return name || null;
}
