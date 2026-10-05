/**
 * Cadence de relance des factures impayées. Module pur — pas de DB, pas d'API.
 *
 * Avant, la vue Relances ne savait dire qu'une chose : l'échéance est passée,
 * ou elle ne l'est pas. Elle ne disait pas si une relance était *attendue
 * maintenant*, ce qui est la seule question qu'on se pose devant la liste.
 *
 * La cadence vient du template de la marque (`reminderCadenceDays`), exprimée
 * en jours après l'échéance.
 */

import type { InvoiceBrand } from "@/db/schema/invoices";
import { brandTemplateFor } from "./brand-templates";

export type ReminderState = {
  /** Une relance est attendue aujourd'hui ou l'était déjà. */
  due: boolean;
  /** Numéro de la prochaine relance attendue (1 = première). */
  stage: number;
  /** Date à laquelle cette relance était/sera attendue, ISO. */
  dueOn: string | null;
  /** Jours de retard sur cette relance. Négatif = elle n'est pas encore due. */
  daysLate: number | null;
  /** La cadence est épuisée : toutes les relances prévues ont été faites. */
  exhausted: boolean;
};

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenISO(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Où en est la relance d'une facture.
 *
 * `reminderCount` sert d'index dans la cadence : une facture relancée une fois
 * attend sa deuxième relance. On ne se fie pas à `lastRemindedAt` pour décider
 * du palier, seulement pour ne pas réclamer deux relances le même jour — sinon
 * une facture relancée en avance resterait bloquée sur le même palier.
 *
 * Sans échéance, pas de cadence : on ne sait pas à partir de quand compter.
 */
export function reminderState(args: {
  brand: InvoiceBrand;
  dueDate: string | null;
  reminderCount: number;
  lastRemindedAt: string | null;
  /** Date du jour, ISO (YYYY-MM-DD). */
  today: string;
}): ReminderState {
  const cadence = brandTemplateFor(args.brand).reminderCadenceDays;

  if (!args.dueDate || cadence.length === 0) {
    return {
      due: false,
      stage: args.reminderCount + 1,
      dueOn: null,
      daysLate: null,
      exhausted: false,
    };
  }

  const stage = args.reminderCount + 1;
  if (args.reminderCount >= cadence.length) {
    return { due: false, stage, dueOn: null, daysLate: null, exhausted: true };
  }

  const offset = cadence[args.reminderCount] as number;
  const dueOn = addDaysISO(args.dueDate, offset);
  const daysLate = daysBetweenISO(dueOn, args.today);

  // Déjà relancé aujourd'hui : on ne redemande pas la même relance deux fois
  // dans la journée, même si le palier est atteint.
  const remindedToday = args.lastRemindedAt?.slice(0, 10) === args.today;

  return { due: daysLate >= 0 && !remindedToday, stage, dueOn, daysLate, exhausted: false };
}

/** Libellé court pour l'UI, ou `null` s'il n'y a rien à dire. */
export function reminderLabel(state: ReminderState): string | null {
  if (state.exhausted) return "Cadence épuisée";
  if (state.dueOn === null) return null;
  if (state.due) {
    return state.daysLate === 0
      ? `Relance ${state.stage} attendue aujourd'hui`
      : `Relance ${state.stage} en retard de ${state.daysLate} j`;
  }
  const inDays = state.daysLate === null ? null : -state.daysLate;
  return inDays === null ? null : `Relance ${state.stage} dans ${inDays} j`;
}
