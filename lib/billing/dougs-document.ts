/**
 * Patches de document Dougs. Module pur — pas de DB, pas d'API — pour
 * rester testable là où `dougs-push.ts` est marqué `server-only`.
 */
import type { DocumentOverrides } from "./brand-templates";
import type { DougsInvoiceLine } from "./dougs-lines";

/**
 * Construit le patch des mentions du document, en **fusionnant** avec ce que
 * Dougs a déjà posé sur le brouillon.
 *
 * La fusion clé par clé n'est pas cosmétique : `legalData` porte l'IBAN et les
 * pénalités de retard, `footerData` porte l'identité légale complète (SIRET,
 * RCS, capital, TVA). Remplacer ces objets en bloc effacerait des mentions
 * obligatoires de la facture.
 */
export function buildDocumentPatch(
  draft: Record<string, unknown>,
  ov: DocumentOverrides | undefined,
): Record<string, unknown> {
  if (!ov || Object.keys(ov).length === 0) return {};
  const patch: Record<string, unknown> = {};

  if (ov.invoicerOthers !== undefined) patch.invoicerOthers = ov.invoicerOthers;
  if (ov.thankYouNote !== undefined) patch.thankYouNote = ov.thankYouNote;
  if (ov.dueDateOption !== undefined) patch.dueDateOption = ov.dueDateOption;
  if (ov.logoUuid !== undefined) patch.logoUuid = ov.logoUuid;

  if (ov.paymentTerms !== undefined || ov.latePaymentTerms !== undefined) {
    const current = (draft.legalData ?? {}) as Record<string, unknown>;
    patch.legalData = {
      ...current,
      ...(ov.paymentTerms !== undefined ? { paymentTerms: ov.paymentTerms } : {}),
      ...(ov.latePaymentTerms !== undefined ? { latePaymentTerms: ov.latePaymentTerms } : {}),
    };
  }

  if (ov.footerOthers !== undefined) {
    const current = (draft.footerData ?? {}) as Record<string, unknown>;
    patch.footerData = { ...current, others: ov.footerOthers };
  }

  return patch;
}

/** Ce qu'un agent peut changer sur un brouillon déjà poussé. */
export type DraftEdit = {
  subject?: string;
  lines?: DougsInvoiceLine[];
  document?: DocumentOverrides;
  /** Champs client, fusionnés avec le `clientData` existant. */
  client?: Record<string, unknown>;
};

/**
 * Payload d'une modification de brouillon : le brouillon tel que Dougs le
 * tient, avec seulement ce qu'on change par-dessus. Le spread est
 * obligatoire, comme à la création : Dougs réécrit le document entier, et
 * tout champ absent est effacé (numérotation, IBAN, mentions légales).
 */
export function buildDraftUpdatePayload(
  draft: Record<string, unknown>,
  edit: DraftEdit,
): Record<string, unknown> {
  const current = (draft.clientData ?? {}) as Record<string, unknown>;
  return {
    ...draft,
    ...(edit.subject !== undefined ? { subject: edit.subject } : {}),
    ...(edit.lines ? { lines: edit.lines } : {}),
    ...buildDocumentPatch(draft, edit.document),
    ...(edit.client ? { clientData: { ...current, ...edit.client } } : {}),
  };
}
