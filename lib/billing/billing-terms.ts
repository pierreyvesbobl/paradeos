/**
 * Conditions de facturation négociées par deal. Module pur — pas de DB, pas d'API.
 *
 * Deux niveaux, résolus clé par clé :
 *   1. la marque (`lib/billing/brand-templates.ts`) donne les défauts ;
 *   2. le projet client ou le contrat coworking peut surcharger.
 *
 * La surcharge est **éparse** : seules les clés réellement négociées sont
 * stockées. Conséquence voulue — changer un défaut de marque atteint tous les
 * deals qui n'ont rien surchargé, alors qu'une copie des défauts à la création
 * les aurait figés le jour de leur création.
 */

import type { InvoiceBrand } from "@/db/schema/invoices";
import { type DocumentOverrides, brandTemplateFor } from "./brand-templates";

/**
 * Échéances que l'API Dougs accepte, et le délai correspondant en jours.
 *
 * Liste fermée **vérifiée par sondage le 2026-10-05**, pas devinée :
 * `ON_RECEIPT`, `DAYS_7`, `DAYS_45` et `END_OF_MONTH` font répondre 400. Une
 * échéance à 45 jours n'est donc pas représentable sur le document Dougs.
 */
export const DUE_DATE_OPTIONS = {
  DAYS_15: 15,
  DAYS_30: 30,
  DAYS_60: 60,
} as const;

export type DueDateOption = keyof typeof DUE_DATE_OPTIONS;

export const DUE_DATE_OPTION_LABELS: Record<DueDateOption, string> = {
  DAYS_15: "15 jours",
  DAYS_30: "30 jours",
  DAYS_60: "60 jours",
};

export function isDueDateOption(v: unknown): v is DueDateOption {
  return typeof v === "string" && v in DUE_DATE_OPTIONS;
}

/** Délai en jours d'une option. Retombe sur 30 si la valeur est inattendue. */
export function dueDaysForOption(option: string | null | undefined): number {
  return isDueDateOption(option) ? DUE_DATE_OPTIONS[option] : DUE_DATE_OPTIONS.DAYS_30;
}

/**
 * Ce qu'un deal peut renégocier. Toutes les clés sont optionnelles, et une clé
 * absente signifie « garder le défaut de la marque ».
 *
 * `thankYouNote: null` est distinct de `thankYouNote` absent : `null` efface
 * explicitement la note, l'absence la laisse telle quelle.
 */
export type BillingTerms = {
  paymentTerms?: string;
  dueDateOption?: DueDateOption;
  footerOthers?: string[];
  thankYouNote?: string | null;
};

export type ResolvedBillingTerms = {
  /** À poser sur le brouillon Dougs. */
  document: DocumentOverrides;
  /** Délai de paiement effectif, pour `invoices.due_date` et les relances. */
  dueDays: number;
};

/**
 * Lit prudemment un `billing_terms` venu de la base : c'est du `jsonb`, donc
 * rien ne garantit sa forme (migration, écriture manuelle, version
 * antérieure). Une clé illisible est ignorée plutôt que de faire tomber un
 * push de facture.
 */
export function parseBillingTerms(raw: unknown): BillingTerms {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const terms: BillingTerms = {};

  if (typeof o.paymentTerms === "string" && o.paymentTerms.trim()) {
    terms.paymentTerms = o.paymentTerms;
  }
  if (isDueDateOption(o.dueDateOption)) terms.dueDateOption = o.dueDateOption;
  if (Array.isArray(o.footerOthers)) {
    terms.footerOthers = o.footerOthers.filter((x): x is string => typeof x === "string");
  }
  // `null` est une valeur signifiante ici : elle efface la note.
  if (o.thankYouNote === null || typeof o.thankYouNote === "string") {
    terms.thankYouNote = o.thankYouNote;
  }
  return terms;
}

/**
 * Fusionne les défauts de la marque et les conditions du deal.
 *
 * Le délai en jours est **dérivé** de l'option d'échéance, jamais stocké à
 * côté : c'est ce qui garantit que l'échéance imprimée sur la facture et celle
 * que Parade OS utilise pour relancer ne peuvent pas diverger.
 */
export function resolveBillingTerms(brand: InvoiceBrand, rawTerms?: unknown): ResolvedBillingTerms {
  const template = brandTemplateFor(brand);
  const terms = parseBillingTerms(rawTerms);

  const document: DocumentOverrides = { ...template.document };
  if (terms.paymentTerms !== undefined) document.paymentTerms = terms.paymentTerms;
  if (terms.footerOthers !== undefined) document.footerOthers = terms.footerOthers;
  if (terms.thankYouNote !== undefined) document.thankYouNote = terms.thankYouNote;
  if (terms.dueDateOption !== undefined) document.dueDateOption = terms.dueDateOption;

  return { document, dueDays: dueDaysForOption(document.dueDateOption) };
}

/** Échéance effective d'une facture, à partir de sa date d'émission. */
export function dueDateFrom(invoicedAt: Date, dueDays: number): Date {
  const due = new Date(invoicedAt);
  due.setDate(due.getDate() + dueDays);
  return due;
}
