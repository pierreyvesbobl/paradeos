/**
 * Helpers de lecture tolérants aux deux schémas Dougs :
 * - "détail" Angular (édition) : totalNetAmount / totalAmountWithVat /
 *   totalVatAmount / clientData.legalName / status
 * - "liste compacte" : netAmount / amount / vatAmount / clientData.name
 *   (ou clientName en racine) / paymentStatus
 *
 * Le détail endpoint /sales-invoices/{id} renvoie parfois le format
 * compact aussi (vérifié 2026-05). Donc on doit toujours lire les deux.
 */
export type DougsOperationAttachment = {
  operation?: {
    date?: string | null;
    validatedAt?: string | null;
    deleted?: boolean | null;
    excluded?: boolean | null;
  } | null;
};

export type DougsPayloadAny = {
  totalNetAmount?: number | null;
  totalAmountWithVat?: number | null;
  totalVatAmount?: number | null;
  netAmount?: unknown;
  amount?: unknown;
  vatAmount?: unknown;
  paidAt?: string | null;
  issuedAt?: string | null;
  date?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  operationAttachments?: DougsOperationAttachment[] | null;
  /** Pré-match bancaire non validé — cf. pickDougsPaymentHint. */
  operationCandidate?: unknown;
  reference?: unknown;
  numberPrefix?: unknown;
  number?: unknown;
  salesInvoiceId?: unknown;
  filePath?: unknown;
  pdfFileId?: unknown;
  file?: unknown;
  fileId?: unknown;
  clientName?: string | null;
  clientData?: {
    legalName?: string | null;
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    siren?: string | null;
  } | null;
  [key: string]: unknown;
};

export function pickDougsHt(o: DougsPayloadAny): number | null {
  if (typeof o.totalNetAmount === "number") return o.totalNetAmount;
  if (typeof o.netAmount === "number") return o.netAmount;
  return null;
}

export function pickDougsTtc(o: DougsPayloadAny): number | null {
  if (typeof o.totalAmountWithVat === "number") return o.totalAmountWithVat;
  if (typeof o.amount === "number") return o.amount;
  return null;
}

export function pickDougsVat(o: DougsPayloadAny): number | null {
  if (typeof o.totalVatAmount === "number") return o.totalVatAmount;
  if (typeof o.vatAmount === "number") return o.vatAmount;
  return null;
}

export function pickDougsPaidAt(o: DougsPayloadAny): string | null {
  // Sur les factures réconciliées via rapprochement bancaire, Dougs laisse
  // `paidAt: null` mais expose la vraie date dans operationAttachments[].
  // On prend la date de virement la plus ancienne (cas paiement en
  // plusieurs fois → première rentrée d'argent), en ignorant les
  // opérations supprimées/exclues.
  if (o.paidAt) return o.paidAt;
  const ops = Array.isArray(o.operationAttachments) ? o.operationAttachments : [];
  const dates = ops
    .map((a) => a?.operation)
    .filter((op): op is NonNullable<typeof op> => !!op && !op.deleted && !op.excluded)
    .map((op) => op.date ?? op.validatedAt ?? null)
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .sort();
  return dates[0] ?? null;
}

export function pickDougsIssuedAt(o: DougsPayloadAny): string | null {
  return o.issuedAt ?? o.date ?? null;
}

/**
 * Référence lisible d'une facture ou d'un devis. Dougs la renvoie tantôt dans
 * `reference`, tantôt seulement en pièces détachées (`numberPrefix` + `number`)
 * — observé sur une facture fraîchement finalisée, dont le `reference` était
 * absent alors que le numéro était bien attribué.
 */
export function pickDougsReference(o: DougsPayloadAny): string | null {
  const direct = (o as { reference?: unknown }).reference;
  if (typeof direct === "string" && direct.trim()) return direct;
  const prefix = (o as { numberPrefix?: unknown }).numberPrefix;
  const number = (o as { number?: unknown }).number;
  if (
    typeof prefix === "string" &&
    prefix &&
    (typeof number === "number" || typeof number === "string")
  ) {
    return `${prefix}${number}`;
  }
  if (typeof number === "number" || (typeof number === "string" && number)) return String(number);
  return null;
}

/**
 * UUID du PDF d'une facture ou d'un devis, à passer à `downloadDougsFile`.
 *
 * Attention : le champ `fileId` est un identifiant **numérique** inutilisable
 * tel quel ; l'UUID vit dans `filePath`, de la forme
 * `/files/{uuid}/actions/download`. On accepte aussi `pdfFileId` quand il a
 * déjà la forme d'un UUID.
 */
export function pickDougsFileUuid(o: DougsPayloadAny): string | null {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  for (const key of ["filePath", "pdfFileId", "file", "fileId"] as const) {
    const raw = (o as Record<string, unknown>)[key];
    if (typeof raw !== "string") continue;
    const found = raw.match(UUID);
    if (found) return found[0];
  }
  return null;
}

/**
 * Identifiant de la **facture de vente** derrière un brouillon ou une réponse de
 * finalisation.
 *
 * Piège coûteux : `finalize` répond avec l'`id` du **brouillon**, pas celui de
 * la facture émise. L'utiliser ensuite fait répondre 404 à `send-email`
 * (« SalesInvoice not found for id »). Le bon identifiant est `salesInvoiceId`,
 * que Dougs pose sur le brouillon. Vérifié le 2026-10-06 : brouillon
 * `32656ec4…` → facture `52ec2e30…` pour la référence 2026-10-FAC52.
 */
export function pickDougsSalesInvoiceId(o: DougsPayloadAny): string | null {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const direct = (o as { salesInvoiceId?: unknown }).salesInvoiceId;
  if (typeof direct === "string" && UUID.test(direct)) return direct;
  const own = (o as { id?: unknown }).id;
  return typeof own === "string" && UUID.test(own) ? own : null;
}

export function pickDougsStatus(o: DougsPayloadAny): string | null {
  return o.status ?? o.paymentStatus ?? null;
}

export function pickDougsClientName(o: DougsPayloadAny): string | null {
  const c = o.clientData;
  const fromObj = c?.legalName ?? c?.name ?? `${c?.firstName ?? ""} ${c?.lastName ?? ""}`.trim();
  return (fromObj || o.clientName || null) as string | null;
}
