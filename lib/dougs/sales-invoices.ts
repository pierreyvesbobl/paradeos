import { BASE, DougsApiError, DougsAuthError, dougsFetch, loadSession } from "./http";
import type { DougsOperationAttachment } from "./payload";

export type DougsClientSearchResult = {
  isBtoB: boolean;
  isFromPappers: boolean;
  name: string;
  legalName: string | null;
  firstName: string | null;
  lastName: string | null;
  address: { city?: string; zipcode?: string; street?: string } | null;
  email: string | null;
  phone: string | null;
  siren: string | null;
  vatNumber: string | null;
  clientId: string | null;
};

/**
 * Recherche un client (Dougs + Pappers/INSEE). Retourne les meilleurs
 * matches. Si `isBtoB=true`, recherche par nom de société + SIREN ;
 * sinon par nom de personne.
 */
export async function searchDougsClients(
  userId: string,
  name: string,
  isBtoB: boolean,
): Promise<DougsClientSearchResult[]> {
  const path = `/companies/{companyId}/sales-invoices-drafts/clients?isBtoB=${isBtoB}&name=${encodeURIComponent(
    name,
  )}`;
  const res = await dougsFetch(userId, path);
  return res.json();
}

export type DougsSalesInvoiceDraft = {
  id: string;
  reference: string;
  status: string;
  numberPrefix?: string;
  number?: number;
  // ... beaucoup d'autres champs auto-remplis (invoicerOthers, legalData, etc.)
  [key: string]: unknown;
};

/** Crée un brouillon vide. Reference auto-générée. */
export async function createDougsSalesInvoiceDraft(
  userId: string,
): Promise<DougsSalesInvoiceDraft> {
  const res = await dougsFetch(userId, "/companies/{companyId}/sales-invoices-drafts", {
    method: "POST",
    body: "{}",
  });
  return res.json();
}

/**
 * Update d'un draft via PUT sur la ressource "stable" `/sales-invoices/{id}`.
 *
 * Pattern Dougs counter-intuitif : on POST sur `/sales-invoices-drafts`
 * pour créer, mais on PUT sur `/sales-invoices/{id}` pour mettre à jour
 * (même pattern que pour les devis : POST `/quote-drafts`, PUT `/quotes/{id}`).
 *
 * Le payload doit contenir tous les champs : on spread le `draft`
 * renvoyé par createDraft (qui contient déjà invoicerOthers, legalData,
 * date, etc.) puis on overwrite clientData/lines.
 */
export async function updateDougsSalesInvoice(
  userId: string,
  draftId: string,
  payload: Record<string, unknown>,
): Promise<DougsSalesInvoiceDraft> {
  const res = await dougsFetch(userId, `/companies/{companyId}/sales-invoices-drafts/${draftId}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function deleteDougsSalesInvoiceDraft(userId: string, draftId: string): Promise<void> {
  await dougsFetch(userId, `/companies/{companyId}/sales-invoices-drafts/${draftId}`, {
    method: "DELETE",
  });
}

/** Un motif de refus de finalisation renvoyé par Dougs. */
export type DougsFinalizeBlocker = { field: string; message: string };

/**
 * Parseur tolérant de la réponse `can-finalize`. Dougs documente un tableau
 * d'objets `{field, message}`, mais comme pour les autres endpoints de ce
 * fichier la forme n'a pas pu être vérifiée en live (401 hors Vercel) : on
 * accepte aussi un `null`, un objet qui emballe le tableau, et des entrées
 * qui ne seraient que des chaînes.
 *
 * Le défaut est volontairement « pas de bloqueur » uniquement pour une
 * réponse vide ou nulle. Une forme inattendue remonte un bloqueur
 * synthétique : mieux vaut refuser de finaliser que finaliser à l'aveugle
 * parce qu'on n'a pas su lire la réponse.
 */
export function parseDougsFinalizeBlockers(raw: unknown): DougsFinalizeBlocker[] {
  if (raw == null || raw === "") return [];
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === "object"
      ? ((raw as Record<string, unknown>).errors ??
        (raw as Record<string, unknown>).blockers ??
        (raw as Record<string, unknown>).data)
      : undefined;
  if (arr === undefined) {
    return [{ field: "_unknown", message: `Réponse can-finalize illisible : ${typeof raw}` }];
  }
  if (arr == null) return [];
  if (!Array.isArray(arr)) {
    return [{ field: "_unknown", message: "Réponse can-finalize illisible (pas un tableau)." }];
  }
  return arr.map((item) => {
    if (typeof item === "string") return { field: "_", message: item };
    const o = (item ?? {}) as Record<string, unknown>;
    return {
      field: typeof o.field === "string" ? o.field : "_",
      message:
        typeof o.message === "string"
          ? o.message
          : typeof o.error === "string"
            ? o.error
            : "Blocage non détaillé par Dougs.",
    };
  });
}

/**
 * Vérifie qu'un brouillon de facture de vente est finalisable. Tableau vide
 * = prêt. Les blocages typiques portent sur le client (`legalName`, `address`)
 * ou sur des lignes sans titre ni prix.
 *
 * On ne corrige jamais un blocage en patchant les données émetteur à la
 * place de l'utilisateur : ça concerne souvent les réglages de facturation
 * Parade, qu'il vaut mieux faire corriger à la main.
 */
export async function canFinalizeDougsSalesInvoice(
  userId: string,
  draftId: string,
): Promise<DougsFinalizeBlocker[]> {
  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/sales-invoices-drafts/${draftId}/actions/can-finalize`,
  );
  const text = await res.text();
  if (!text.trim()) return [];
  try {
    return parseDougsFinalizeBlockers(JSON.parse(text));
  } catch {
    return [{ field: "_unknown", message: "Réponse can-finalize non JSON." }];
  }
}

/**
 * Finalise un brouillon : génère le numéro de facture définitif et ouvre le
 * cycle de vie comptable. **Irréversible** — une facture finalisée ne peut
 * plus qu'être annulée par un avoir.
 *
 * Noter le verbe : c'est un POST pour les factures de vente, là où les devis
 * utilisent un PUT. Ne pas recopier le pattern des devis.
 */
export async function finalizeDougsSalesInvoice(
  userId: string,
  draftId: string,
): Promise<DougsSalesInvoiceDraft> {
  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/sales-invoices-drafts/${draftId}/actions/finalize`,
    {
      method: "POST",
      body: "{}",
      // Dougs génère le PDF définitif pendant cet appel : les 8 s par défaut
      // sont trop justes.
      timeoutMs: 20000,
    },
  );
  return res.json();
}

/**
 * Envoie une facture par mail au client, depuis Dougs (le PDF joint est donc le
 * document légal, avec son numéro définitif).
 *
 * S'applique à `/sales-invoices/{id}`, la ressource **finalisée**. Attention :
 * après finalisation Dougs attribue à la facture un **id différent de celui du
 * brouillon** — passer l'id du brouillon ici renvoie 400.
 *
 * La forme du payload a été relevée sur l'UI Dougs (2026-10-05), parce que la
 * doc interne ne la donnait pas et que les noms ne sont pas ceux qu'on devine :
 * `recipient` est une **chaîne** (pas un tableau `to`), le corps s'appelle
 * `message` (pas `body`), et `copyReceivers` / `selfCopy` sont attendus même
 * vides. Un champ inconnu ou manquant fait répondre
 * `{"message":"Bad Request","statusCode":400}`, sans dire lequel.
 */
export async function sendDougsSalesInvoiceEmail(
  userId: string,
  invoiceId: string,
  mail: {
    /** Destinataire principal. Un seul, c'est ce qu'attend Dougs. */
    to: string;
    subject: string;
    body: string;
    /** Destinataires en copie. */
    cc?: string[];
    /** Copie à l'émetteur. */
    selfCopy?: boolean;
  },
): Promise<void> {
  await dougsFetch(
    userId,
    `/companies/{companyId}/sales-invoices/${invoiceId}/actions/send-email`,
    {
      method: "POST",
      body: JSON.stringify({
        recipient: mail.to,
        copyReceivers: mail.cc ?? [],
        selfCopy: mail.selfCopy ?? false,
        subject: mail.subject,
        message: mail.body,
      }),
      timeoutMs: 20000,
    },
  );
}

/**
 * URL de la facture dans l'UI Dougs. Pattern Angular Dougs (vérifié
 * 2026-05) : query params, pas path segments. `salesInvoiceId` ouvre
 * la modal de détail ; `status` détermine quel onglet est actif quand
 * l'utilisateur ferme la modal (waiting / paid / late / draft).
 */
export function buildDougsInvoiceUrl(
  companyId: string,
  invoiceId: string,
  opts: { status?: "waiting" | "paid" | "late" | "draft" | null } = {},
): string {
  const status = opts.status ?? "waiting";
  return `${BASE}/app/c/${companyId}/invoicing/sales-invoice?status=${status}&salesInvoiceId=${invoiceId}`;
}

/**
 * URL du devis dans l'UI Dougs. Pattern symétrique aux factures
 * clients. Pour l'instant on suppose `quoteId` + `status` (draft /
 * pending / accepted / refused).
 */
export function buildDougsQuoteUrl(
  companyId: string,
  quoteId: string,
  opts: { status?: "draft" | "pending" | "accepted" | "refused" | null } = {},
): string {
  const status = opts.status ?? "pending";
  return `${BASE}/app/c/${companyId}/invoicing/quote?status=${status}&quoteId=${quoteId}`;
}

/** Id de société Dougs de la session courante, `null` si pas connecté. */
export async function getDougsCompanyId(userId: string): Promise<string | null> {
  const session = await loadSession(userId);
  return session?.companyId ?? null;
}

/** URL du brouillon dans l'UI Dougs (pour pop-up "voir sur Dougs"). */
export async function getDougsDraftUrl(userId: string, draftId: string): Promise<string> {
  const session = await loadSession(userId);
  if (!session) throw new DougsAuthError("Pas de session Dougs.");
  return buildDougsInvoiceUrl(session.companyId, draftId, { status: "draft" });
}

/**
 * GET d'une facture client (draft ou finalisée). Retourne le payload
 * complet incluant `status`, `totalNetAmount`, `totalVatAmount`,
 * `totalAmountWithVat`, `issuedAt`, `paidAt`. Utilisé pour rafraîchir
 * le snapshot Paradeos après push ou via cron.
 */
export type DougsSalesInvoice = {
  id: string;
  reference?: string;
  status?: string;
  totalNetAmount?: number;
  totalVatAmount?: number;
  totalAmountWithVat?: number;
  issuedAt?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  clientData?: {
    legalName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    siren?: string | null;
  } | null;
  [key: string]: unknown;
};

export async function getDougsSalesInvoice(
  userId: string,
  invoiceId: string,
): Promise<DougsSalesInvoice> {
  // Tente d'abord l'endpoint des factures finalisées. Si 404 (drafts
  // ne sont pas accessibles via /sales-invoices/{id}), on retombe sur
  // /sales-invoices-drafts/{id}.
  try {
    const res = await dougsFetch(userId, `/companies/{companyId}/sales-invoices/${invoiceId}`);
    return res.json();
  } catch (err) {
    if (err instanceof DougsApiError && err.status === 404) {
      const res = await dougsFetch(
        userId,
        `/companies/{companyId}/sales-invoices-drafts/${invoiceId}`,
      );
      return res.json();
    }
    throw err;
  }
}

// ---------- Devis (quotes) ----------

export type DougsSalesInvoiceListItem = {
  id: string;
  reference?: string | null;
  status?: string | null;
  totalNetAmount?: number | null;
  totalAmountWithVat?: number | null;
  /** True si l'entrée est un avoir (facture de remboursement). */
  isRefund?: boolean | null;
  issuedAt?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  dueDate?: string | null;
  paymentStatus?: string | null;
  operationAttachments?: DougsOperationAttachment[] | null;
  /** Pré-match bancaire non validé — cf. pickDougsPaymentHint. */
  operationCandidate?: unknown;
  clientData?: {
    legalName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    siren?: string | null;
  } | null;
  [key: string]: unknown;
};

export async function listDougsSalesInvoices(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<DougsSalesInvoiceListItem[]> {
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;
  const res = await dougsFetch(
    userId,
    `/companies/{companyId}/sales-invoices?limit=${limit}&offset=${offset}`,
  );
  return res.json();
}

// ---------- Rapprochement bancaire suggéré par Dougs ----------

/**
 * Opération bancaire telle que Dougs l'expose en pièce jointe d'une
 * facture. `signedAmount` est négatif pour un décaissement, positif
 * pour un encaissement ; `isInbound` dit la même chose en booléen.
 */
