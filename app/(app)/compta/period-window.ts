import type { ComptaPeriod } from "./period-selector";

/**
 * Convertit un preset de période en fenêtre [start, end[ (UTC local).
 * `start`/`end` null = pas de borne (preset "all"). Le label est utilisé
 * pour afficher la période choisie en clair.
 */
export function periodWindow(period: ComptaPeriod): {
  start: Date | null;
  end: Date | null;
  label: string;
} {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case "current_month":
      return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1), label: "mois en cours" };
    case "last_month":
      return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1), label: "mois dernier" };
    case "last_3_months":
      return { start: new Date(y, m - 2, 1), end: new Date(y, m + 1, 1), label: "3 derniers mois" };
    case "current_year":
      return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1), label: "année en cours" };
    case "last_year":
      return { start: new Date(y - 1, 0, 1), end: new Date(y, 0, 1), label: "année dernière" };
    case "all":
      return { start: null, end: null, label: "tout" };
    default:
      return {
        start: new Date(y, m - 11, 1),
        end: new Date(y, m + 1, 1),
        label: "12 derniers mois",
      };
  }
}

export function inWindow(
  value: Date | null,
  win: { start: Date | null; end: Date | null },
): boolean {
  if (!value) return false;
  if (win.start && value < win.start) return false;
  if (win.end && value >= win.end) return false;
  return true;
}
