/**
 * Helpers calendrier — locale fr-FR, semaine commence le lundi (ISO).
 */

export const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
export const DAY_LABELS_LONG = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

/** Retourne le lundi de la semaine de `d` (00:00 local). */
export function startOfIsoWeek(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // getDay : 0 (dim) → 6 (sam). On veut lundi = 0.
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return date;
}

/** Ajoute n jours et renvoie une nouvelle Date. */
export function addDays(d: Date, n: number): Date {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

/** Format YYYY-MM-DD (date locale). */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format YYYY-MM-DDTHH:mm (sans secondes, locale). Pour input datetime-local. */
export function localDateTimeInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

const longRangeFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });
const longRangeWithYearFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatWeekRange(start: Date): string {
  const end = addDays(start, 6);
  const sameYear = start.getFullYear() === end.getFullYear();
  const startStr = sameYear ? longRangeFmt.format(start) : longRangeWithYearFmt.format(start);
  const endStr = longRangeWithYearFmt.format(end);
  return `${startStr} – ${endStr}`;
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}
