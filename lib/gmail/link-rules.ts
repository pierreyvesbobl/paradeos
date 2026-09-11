import { GENERIC_EMAIL_DOMAINS, domainFromEmail, extractDomain } from "./domain";

/**
 * Règles pures des liaisons emails : nommage des labels Gmail et
 * dérivation des signaux (participants, domaines) d'un thread. Pas de
 * DB ni d'API Gmail ici — `links.ts` fait la plomberie.
 */

/**
 * Préfixe sous lequel Paradeos crée ses labels dans Gmail, pour
 * cohabiter avec les labels existants de l'utilisateur sans les polluer.
 *   Paradeos/Projets/Avenir Focus
 *   Paradeos/Contacts/Jean Dupont
 *   Paradeos/Entités/Acme Corp
 *   Paradeos/Facture achat       (libellé système, niveau 2)
 */
export const LABEL_PREFIX = "Paradeos";

export type LinkKind = "project" | "contact" | "entity";

const KIND_LABEL_SEGMENT: Record<LinkKind, string> = {
  project: "Projets",
  contact: "Contacts",
  entity: "Entités",
};

/**
 * Sanitize un nom pour qu'il soit valide en composant de label Gmail :
 *   - pas de `/` (séparateur de hiérarchie)
 *   - trim
 *   - tronqué à 80 chars (pour rester sous la limite Gmail de 225 chars
 *     sur le label complet)
 */
export function sanitizeLabelSegment(name: string): string {
  return name.trim().replace(/\//g, " ").replace(/\s+/g, " ").slice(0, 80);
}

export function buildLabelName(kind: LinkKind | "category", name: string): string {
  const safe = sanitizeLabelSegment(name);
  if (kind === "category") return `${LABEL_PREFIX}/${safe}`;
  return `${LABEL_PREFIX}/${KIND_LABEL_SEGMENT[kind]}/${safe}`;
}

export const INVOICE_DIRECTION_LABEL = {
  purchase: "Facture achat",
  sale: "Facture vente",
} as const;

export type InvoiceDirection = keyof typeof INVOICE_DIRECTION_LABEL;

export function invoiceDirectionLabelName(direction: InvoiceDirection): string {
  return buildLabelName("category", INVOICE_DIRECTION_LABEL[direction]);
}

export type ParticipantMessage = {
  fromEmail: string | null;
  toEmails: string[] | null;
  ccEmails: string[] | null;
};

/**
 * Adresses impliquées dans un thread (from + to + cc), en minuscules,
 * dédoublonnées, dans l'ordre de première apparition.
 */
export function collectInvolvedEmails(msgs: ParticipantMessage[]): string[] {
  const involved = new Set<string>();
  for (const m of msgs) {
    if (m.fromEmail) involved.add(m.fromEmail.toLowerCase());
    for (const e of m.toEmails ?? []) involved.add(e.toLowerCase());
    for (const e of m.ccEmails ?? []) involved.add(e.toLowerCase());
  }
  return [...involved];
}

/**
 * Domaines « signifiants » des participants : on écarte les webmails
 * génériques (gmail, outlook…) qui n'identifient aucune entité.
 */
export function collectInvolvedDomains(emails: Iterable<string>): Set<string> {
  const domains = new Set<string>();
  for (const e of emails) {
    const d = domainFromEmail(e);
    if (d && !GENERIC_EMAIL_DOMAINS.has(d)) domains.add(d);
  }
  return domains;
}

/** Entités dont le site web tombe sur l'un des domaines impliqués. */
export function matchEntityIdsByDomain(
  entityRows: { id: string; website: string | null }[],
  involvedDomains: Set<string>,
): string[] {
  const out: string[] = [];
  for (const e of entityRows) {
    const d = extractDomain(e.website);
    if (d && involvedDomains.has(d)) out.push(e.id);
  }
  return out;
}
