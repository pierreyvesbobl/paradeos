/**
 * Cycle de vie d'une facture Paradeos : échéances, transitions de statut,
 * conversions vers/depuis Dougs. Module pur (pas de DB, pas d'API) —
 * les Server Actions de `lib/actions/invoices.ts` s'appuient dessus.
 */

export type InvoiceStatus = "draft" | "sent" | "accepted" | "refused" | "paid";
export type QuoteLocalStatus = Exclude<InvoiceStatus, "paid">;

/** Délai par défaut (30j) appliqué quand une facture passe à 'sent' sans due_date. */
export const DEFAULT_DUE_DAYS = 30;

/** Renvoie YYYY-MM-DD = base + days (UTC, suffisant pour une date). */
export function addDaysISO(base: Date, days: number): string {
  const d = new Date(base.getTime() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Numeric Postgres (2 décimales) ou null si la valeur n'est pas un nombre fini. */
export function toNumeric(n: number | null | undefined): string | null {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : null;
}

/** Date depuis une ISO string, null si absente ou invalide. */
export function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Mapping Dougs status → invoice_status local pour les devis. Doit
 * rester cohérent avec le cron sync-dougs-status.
 */
export function mapDougsQuoteStatus(dougs: string | null): QuoteLocalStatus {
  switch ((dougs ?? "").toUpperCase()) {
    case "ACCEPTED":
      return "accepted";
    case "REFUSED":
      return "refused";
    case "DRAFT":
      return "draft";
    default:
      return "sent"; // PENDING ou inconnu
  }
}

/**
 * Une facture Dougs est payée si son statut le dit OU si une date de
 * paiement existe (rapprochement bancaire sans statut « paid »).
 */
export function isDougsInvoicePaid(
  dougsStatus: string | null,
  paidAt: string | Date | null,
): boolean {
  return (dougsStatus ?? "").toLowerCase() === "paid" || paidAt !== null;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Accepte un UUID brut OU une URL Dougs et renvoie l'UUID extrait.
 * Couvre les patterns d'URL Dougs (sales-invoice / quote / drafts).
 */
export function extractDougsUuid(input: string): string {
  const match = input.trim().match(UUID_RE);
  if (!match) {
    throw new Error(
      "ID Dougs introuvable. Colle un UUID ou une URL Dougs (.../sales-invoice... ou .../quote...).",
    );
  }
  return match[0];
}

/**
 * Échéance à écrire lors d'un upsert. Si l'appelant en fournit une,
 * elle l'emporte (y compris null explicite). Sinon, on garde
 * l'existante. Sinon, on génère une valeur uniquement quand
 * status='sent' (point d'émission) : invoiced_at (ou now) + 30j.
 */
export function resolveUpsertDueDate(args: {
  /** `undefined` = non fourni ; `null` = effacement explicite. */
  inputDueDate: string | null | undefined;
  status: InvoiceStatus;
  existing: { invoicedAt: Date | null; dueDate: string | null } | null;
  now: Date;
}): string | null {
  if (args.inputDueDate !== undefined) return args.inputDueDate;
  const fallbackBase = args.existing?.invoicedAt ?? args.now;
  return (
    args.existing?.dueDate ??
    (args.status === "sent" ? addDaysISO(fallbackBase, DEFAULT_DUE_DAYS) : null)
  );
}

export type StatusTransition = {
  invoicedAt: Date | null;
  paidAt: Date | null;
  dueDate: string | null;
  /** Le lead projet doit être posé comme assignee s'il n'y a personne. */
  needsAssigneeFromProject: boolean;
};

/**
 * Effets d'un changement de statut sur les dates :
 *   - draft efface invoiced_at et paid_at (la facture n'est plus émise) ;
 *   - toute autre valeur pose invoiced_at si absent ;
 *   - paid pose paid_at si absent, les autres statuts le conservent ;
 *   - sent sans due_date initialise invoiced_at + 30j. La due_date
 *     existante n'est jamais touchée, même au retour à draft.
 */
export function resolveStatusTransition(args: {
  status: InvoiceStatus;
  existing: {
    invoicedAt: Date | null;
    paidAt: Date | null;
    dueDate: string | null;
    assignedTo: string | null;
  };
  now: Date;
}): StatusTransition {
  const { status, existing, now } = args;
  const invoicedAt = status === "draft" ? null : (existing.invoicedAt ?? now);
  const paidAt =
    status === "paid" ? (existing.paidAt ?? now) : status === "draft" ? null : existing.paidAt;
  const dueDate =
    status === "sent" && !existing.dueDate && invoicedAt
      ? addDaysISO(invoicedAt, DEFAULT_DUE_DAYS)
      : existing.dueDate;
  return {
    invoicedAt,
    paidAt,
    dueDate,
    needsAssigneeFromProject: status === "sent" && !existing.assignedTo,
  };
}
