import { BASE, DougsApiError, dougsFetch } from "./http";
import type { DougsOperationAttachment, DougsPayloadAny } from "./payload";

export type DougsOperationRef = {
  id: number;
  date: string;
  amount: number;
  wording: string;
  type?: string;
  isInbound?: boolean;
  signedAmount?: number;
  deleted?: boolean;
  excluded?: boolean;
  [key: string]: unknown;
};

/**
 * `operationCandidate` : le pré-match que Dougs calcule tout seul entre
 * une facture et une opération du flux bancaire, **avant** validation
 * par le comptable. Tant qu'il n'est pas validé, `paidAt` reste `null`
 * et `operationAttachments` est vide — donc côté Paradeos la facture
 * a l'air impayée alors que l'argent est déjà sur le compte.
 *
 * C'est exactement le cas où il ne faut PAS relancer le client.
 */
export type DougsOperationCandidate = {
  id: number;
  operation: DougsOperationRef;
};

export type DougsPaymentHint = {
  operationId: number;
  /** Date de l'opération bancaire (ISO). */
  date: string | null;
  /** Montant encaissé, toujours positif. */
  amount: number | null;
  /** Libellé brut du relevé, utile pour lever un doute à l'œil. */
  wording: string | null;
};

/**
 * Extrait le pré-match d'encaissement d'une facture, s'il y en a un.
 *
 * Renvoie `null` si :
 *  - il n'y a pas de candidat ;
 *  - le candidat est un décaissement (`isInbound === false` ou
 *    `signedAmount < 0`) — ça arrive sur les avoirs, et un remboursement
 *    sortant n'est pas un encaissement client ;
 *  - l'opération est supprimée ou exclue du rapprochement.
 *
 * On ne regarde volontairement pas `operationAttachments` ici : quand
 * l'attachement existe, le rapprochement est déjà validé et `paidAt` /
 * `pickDougsPaidAt` font le travail. Le candidat n'a d'intérêt que sur
 * la fenêtre "argent arrivé, écriture pas encore validée".
 */
export function pickDougsPaymentHint(o: DougsPayloadAny): DougsPaymentHint | null {
  const candidate = o.operationCandidate;
  if (!candidate || typeof candidate !== "object") return null;
  const op = (candidate as DougsOperationCandidate).operation;
  if (!op || typeof op !== "object") return null;
  if (op.deleted === true || op.excluded === true) return null;

  const signed = typeof op.signedAmount === "number" ? op.signedAmount : null;
  const inbound = typeof op.isInbound === "boolean" ? op.isInbound : signed !== null && signed > 0;
  if (!inbound) return null;

  const amount =
    signed !== null ? Math.abs(signed) : typeof op.amount === "number" ? Math.abs(op.amount) : null;
  return {
    operationId: op.id,
    date: typeof op.date === "string" ? op.date : null,
    amount,
    wording: typeof op.wording === "string" ? op.wording : null,
  };
}

// ---------- Balance âgée ----------

/**
 * Balance âgée native Dougs (`/invoice-stats/aging-balance`).
 *
 * Le format exact n'est pas documenté et n'a pas pu être vérifié en
 * local (Dougs répond 401 hors Vercel, cf. Cloudflare). On garde donc
 * les deux blocs en `unknown` et on normalise à la lecture avec
 * `parseDougsAgingBuckets`, tolérant aux variantes de nommage.
 */

export type DougsVendorInvoice = {
  id: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  date?: string | null;
  label?: string | null;
  memo?: string | null;
  reference?: string | null;
  supplierName?: string | null;
  supplierCountry?: string | null;
  amount?: number | null;
  amountTva?: number | null;
  currency?: string | null;
  isRefund?: boolean | null;
  isLocked?: boolean | null;
  type?: string | null;
  paymentStatus?: string | null;
  prefillStatus?: string | null;
  /** UUID du justificatif, à passer à `downloadDougsFile`. */
  fileId?: number | string | null;
  fileName?: string | null;
  fileType?: string | null;
  filePath?: string | null;
  operationAttachments?: DougsOperationAttachment[] | null;
  operationCandidate?: DougsOperationCandidate | null;
  matchedOperation?: DougsOperationRef | null;
  [key: string]: unknown;
};

export async function listDougsVendorInvoices(
  userId: string,
  opts: { limit?: number; page?: number } = {},
): Promise<DougsVendorInvoice[]> {
  const limit = opts.limit ?? 100;
  const page = opts.page ?? 1;
  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/vendor-invoices?limit=${limit}&page=${page}`,
  );
  return res.json();
}

export async function getDougsVendorInvoice(
  userId: string,
  invoiceId: string,
): Promise<DougsVendorInvoice> {
  const res = await dougsFetch(userId, `/companies/{companyId}/vendor-invoices/${invoiceId}`);
  return res.json();
}

/** URL de la facture d'achat dans l'UI Dougs. */
export function buildDougsVendorInvoiceUrl(companyId: string, invoiceId: string): string {
  return `${BASE}/app/c/${companyId}/invoicing/vendor-invoice?vendorInvoiceId=${invoiceId}`;
}

// ---------- Opérations bancaires & justificatifs ----------

/**
 * Pièce justificative attachée à une opération. Le champ qui compte est
 * `id` : c'est lui qui permet de détacher une pièce posée par erreur.
 */
export type DougsSourceDocumentAttachment = {
  id: number | string;
  fileName?: string | null;
  fileId?: number | string | null;
  [key: string]: unknown;
};

/**
 * Opération du relevé, telle que `/operations` la renvoie. Superset de
 * `DougsOperationRef` : la liste porte en plus l'état de validation et
 * les pièces déjà attachées, qui sont exactement ce qu'on vient chercher.
 */
export type DougsOperation = DougsOperationRef & {
  validated?: boolean | null;
  sourceDocumentAttachments?: DougsSourceDocumentAttachment[] | null;
};

/**
 * Liste les opérations bancaires.
 *
 * `validated=false&needsAttention=false` donne les opérations « à valider »
 * standard — celles dont on cherche les justificatifs manquants.
 */
export async function listDougsOperations(
  userId: string,
  opts: {
    limit?: number;
    offset?: number;
    validated?: boolean;
    needsAttention?: boolean;
  } = {},
): Promise<DougsOperation[]> {
  const params = new URLSearchParams({
    limit: String(opts.limit ?? 100),
    offset: String(opts.offset ?? 0),
  });
  if (opts.validated !== undefined) params.set("validated", String(opts.validated));
  if (opts.needsAttention !== undefined) {
    params.set("needsAttention", String(opts.needsAttention));
  }
  const res = await dougsFetch(userId, `/companies/{companyId}/operations?${params}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** Détail d'une opération — c'est ici qu'on relit `sourceDocumentAttachments`. */
export async function getDougsOperation(
  userId: string,
  operationId: number | string,
): Promise<DougsOperation> {
  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/operations/${encodeURIComponent(String(operationId))}`,
  );
  return res.json();
}

/**
 * Attache un justificatif à une opération.
 *
 * Deux détails non négociables de l'API, découverts à la main : le
 * suffixe `/actions/create-from-formdata` (sans lui, 400) et le champ
 * FormData nommé exactement `file`.
 *
 * Cette fonction ne valide JAMAIS l'opération : après l'upload, elle
 * reste « à valider » côté Dougs, et c'est à un humain de trancher. Toute
 * évolution de ce module doit préserver ça.
 */
export async function uploadDougsOperationAttachment(
  userId: string,
  operationId: number | string,
  file: { filename: string; bytes: Buffer; contentType?: string },
): Promise<DougsSourceDocumentAttachment | null> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(file.bytes)], { type: file.contentType ?? "application/pdf" }),
    file.filename,
  );

  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/operations/${encodeURIComponent(
      String(operationId),
    )}/source-document-attachments/actions/create-from-formdata`,
    { method: "POST", body: form, multipart: true, timeoutMs: 30_000 },
  );

  // Dougs renvoie tantôt l'attachement créé, tantôt l'opération entière.
  // On récupère l'identifiant dans les deux cas — sans lui, « Détacher »
  // ne serait plus possible.
  try {
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return null;
    const list = (data as { sourceDocumentAttachments?: unknown }).sourceDocumentAttachments;
    if (Array.isArray(list)) {
      return (list[list.length - 1] as DougsSourceDocumentAttachment) ?? null;
    }
    return data as DougsSourceDocumentAttachment;
  } catch {
    return null;
  }
}

/** Retire une pièce attachée par erreur. */
export async function deleteDougsOperationAttachment(
  userId: string,
  operationId: number | string,
  attachmentId: number | string,
): Promise<void> {
  await dougsFetch(
    userId,
    `/companies/{companyId}/operations/${encodeURIComponent(
      String(operationId),
    )}/source-document-attachments/${encodeURIComponent(String(attachmentId))}`,
    { method: "DELETE" },
  );
}

/** URL de la liste des opérations dans l'UI Dougs. */
/**
 * Téléverse une image comme logo de facturation et renvoie son UUID, à poser
 * sur `logoUuid` d'un devis ou d'une facture.
 *
 * Endpoint relevé sur l'UI Dougs (2026-10-05) :
 * `POST /companies/{id}/attachments?filename=…&type=invoicingLogo`, multipart,
 * champ nommé exactement `file`. Le nom de fichier est passé **deux fois** —
 * en query et dans le Content-Disposition — c'est ce que fait l'UI.
 *
 * À la différence d'un téléversement depuis les réglages Dougs, cet appel ne
 * crée que la pièce jointe : il **ne déplace pas** `defaultLogoUuid`. C'est
 * exactement ce qu'on veut, puisque ce défaut est global à la société et
 * repeindrait les factures de toutes les marques.
 *
 * La forme de la réponse n'est pas documentée, d'où l'extraction tolérante de
 * l'UUID.
 */
export async function uploadDougsInvoicingLogo(
  userId: string,
  file: { filename: string; content: Buffer; contentType: string },
): Promise<{ uuid: string; raw: unknown }> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(file.content)], { type: file.contentType }),
    file.filename,
  );

  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/attachments?filename=${encodeURIComponent(file.filename)}&type=invoicingLogo`,
    { method: "POST", body: form, multipart: true, timeoutMs: 30000 },
  );
  const raw = await res.json();
  const uuid = pickUuidDeep(raw);
  if (!uuid) {
    throw new DougsApiError(
      "Logo téléversé mais Dougs n'a pas renvoyé d'identifiant exploitable.",
      res.status,
      JSON.stringify(raw).slice(0, 300),
    );
  }
  return { uuid, raw };
}

/**
 * Cherche un UUID n'importe où dans une réponse Dougs. Volontairement laxiste :
 * selon les endpoints l'identifiant s'appelle `uuid`, `id`, ou n'apparaît que
 * dans un `filePath`, et on ne sait pas lequel s'applique ici.
 */
function pickUuidDeep(value: unknown, depth = 0): string | null {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  if (depth > 4) return null;
  if (typeof value === "string") return value.match(UUID)?.[0] ?? null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = pickUuidDeep(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    // On privilégie les clés les plus probables avant de ratisser le reste.
    const o = value as Record<string, unknown>;
    for (const key of ["uuid", "fileUuid", "filePath", "id", "file"]) {
      if (key in o) {
        const found = pickUuidDeep(o[key], depth + 1);
        if (found) return found;
      }
    }
    for (const v of Object.values(o)) {
      const found = pickUuidDeep(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Réglages de facturation de la société : identité légale de l'émetteur,
 * numérotation, logo par défaut. Lecture seule.
 */
export async function getDougsInvoicer(userId: string): Promise<Record<string, unknown>> {
  const res = await dougsFetch(userId, "/companies/{companyId}/invoicer");
  return res.json();
}

export function buildDougsOperationsUrl(companyId: string): string {
  return `${BASE}/app/c/${companyId}/accounting/operations/payments`;
}

// ---------- Téléchargement de justificatifs ----------
