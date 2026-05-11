import { z } from "zod";

export const contactQualificationEnum = z.enum([
  "lead",
  "client",
  "coworker",
  "partner",
  "supplier",
  "other",
]);
export type ContactQualification = z.infer<typeof contactQualificationEnum>;
export const contactQualificationLabels: Record<ContactQualification, string> = {
  lead: "Lead",
  client: "Client",
  coworker: "Coworker",
  partner: "Partenaire",
  supplier: "Fournisseur",
  other: "Autre",
};

export const coworkingContractStatusEnum = z.enum(["en_cours", "termine"]);
export type CoworkingContractStatus = z.infer<typeof coworkingContractStatusEnum>;
export const coworkingContractStatusLabels: Record<CoworkingContractStatus, string> = {
  en_cours: "En cours",
  termine: "Terminé",
};

export const coworkingBillingFrequencyEnum = z.enum(["monthly", "quarterly"]);
export type CoworkingBillingFrequency = z.infer<typeof coworkingBillingFrequencyEnum>;
export const coworkingBillingFrequencyLabels: Record<CoworkingBillingFrequency, string> = {
  monthly: "Mensuel",
  quarterly: "Trimestriel",
};
export const coworkingBillingFrequencyMonths: Record<CoworkingBillingFrequency, number> = {
  monthly: 1,
  quarterly: 3,
};

export const coworkingInvoiceStatusEnum = z.enum(["a_facturer", "envoyee", "payee"]);
export type CoworkingInvoiceStatus = z.infer<typeof coworkingInvoiceStatusEnum>;
export const coworkingInvoiceStatusLabels: Record<CoworkingInvoiceStatus, string> = {
  a_facturer: "À facturer",
  envoyee: "Envoyée",
  payee: "Payée",
};

export const coworkingInvoiceBilledByEnum = z.enum(["parade", "g_and_o"]);
export type CoworkingInvoiceBilledBy = z.infer<typeof coworkingInvoiceBilledByEnum>;
export const coworkingInvoiceBilledByLabels: Record<CoworkingInvoiceBilledBy, string> = {
  parade: "Parade",
  g_and_o: "G&O",
};

const decimalString = z.union([z.string(), z.number()]).transform((v) => String(v));

export const createCoworkingContractSchema = z.object({
  name: z.string().min(1, "Nom requis."),
  contactId: z.string().uuid().nullable().optional(),
  /** Quand défini → facturer au nom de l'entité (B2B). Sinon → contact (B2C). */
  billToEntityId: z.string().uuid().nullable().optional(),
  startDate: z.string().min(1, "Date de début requise."),
  endDate: z.string().nullable().optional(),
  desks: z.number().int().positive(),
  unitPriceHt: decimalString,
  status: coworkingContractStatusEnum.default("en_cours"),
  billingFrequency: coworkingBillingFrequencyEnum.default("quarterly"),
  notes: z.string().nullable().optional(),
});
export type CreateCoworkingContractInput = z.infer<typeof createCoworkingContractSchema>;

export const updateCoworkingContractSchema = createCoworkingContractSchema.partial().extend({
  id: z.string().uuid(),
});

export const createCoworkingInvoiceSchema = z.object({
  contractId: z.string().uuid(),
  name: z.string().min(1, "Nom requis."),
  invoiceDate: z.string().nullable().optional(),
  periodStart: z.string().min(1, "Début de période requis."),
  periodEnd: z.string().min(1, "Fin de période requise."),
  status: coworkingInvoiceStatusEnum.default("a_facturer"),
  billedBy: coworkingInvoiceBilledByEnum.default("parade"),
  desks: z.number().int().positive(),
  unitPriceHt: decimalString,
  vatRate: decimalString.default("0.2"),
  notes: z.string().nullable().optional(),
});
export type CreateCoworkingInvoiceInput = z.infer<typeof createCoworkingInvoiceSchema>;

export const updateCoworkingInvoiceSchema = createCoworkingInvoiceSchema.partial().extend({
  id: z.string().uuid(),
});

/**
 * Compte le nombre de mois entiers couverts par une période. Les
 * factures coworking couvrent typiquement des mois pleins (T1 = 3 mois).
 * Inclusif sur les deux bornes : start dans le mois M, end dans le mois N
 * → N - M + 1 mois.
 */
export function monthsBetween(periodStart: string, periodEnd: string): number {
  const s = new Date(`${periodStart}T00:00:00`);
  const e = new Date(`${periodEnd}T00:00:00`);
  const diff = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
  return Math.max(1, diff);
}

/**
 * Total HT = postes × prix mensuel HT × nombre de mois de la période.
 * Le prix sur le contrat est **mensuel** par poste.
 */
export function invoiceTotalHt(
  desks: number,
  monthlyUnitPriceHt: string | number,
  months: number,
): number {
  const u =
    typeof monthlyUnitPriceHt === "string" ? Number(monthlyUnitPriceHt) : monthlyUnitPriceHt;
  return desks * (Number.isFinite(u) ? u : 0) * Math.max(1, months);
}

/** Total TTC. */
export function invoiceTotalTtc(
  desks: number,
  monthlyUnitPriceHt: string | number,
  months: number,
  vatRate: string | number,
): number {
  const v = typeof vatRate === "string" ? Number(vatRate) : vatRate;
  return invoiceTotalHt(desks, monthlyUnitPriceHt, months) * (1 + (Number.isFinite(v) ? v : 0));
}
