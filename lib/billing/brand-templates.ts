/**
 * Templates de facturation par marque. Module pur — pas de DB, pas d'API.
 *
 * Parade SAS est une seule entité juridique (un seul `companyId` Dougs) mais
 * facture sous trois marques : `parade` (divers), `coworking` et `automato`
 * (prestation client). Ce registre est la source de vérité unique de ce qui
 * change d'une marque à l'autre :
 *
 *   - les lignes de facture (libellé, unité, description)
 *   - l'objet de la facture et les mentions / conditions de paiement
 *   - le mail d'accompagnement envoyé avec la facture
 *   - l'échéance et la cadence de relance
 *
 * Avant, tout ça était codé en dur et dupliqué dans les cinq chemins de push
 * (trois server actions + deux handlers MCP), avec des divergences déjà
 * installées. Un registre typé permet de tester le contenu facturé sans
 * toucher à la DB ni à Dougs.
 *
 * Le registre vit en code et pas en base : les quatre axes ci-dessus
 * contiennent de la logique (pluriels, périodes, pourcentages), pas seulement
 * du texte. Si le besoin d'éditer les libellés sans déployer apparaît, on
 * ajoutera des surcharges `app_settings` par-dessus, sans remplacer le
 * registre.
 */

import type { InvoiceBrand, InvoiceKind } from "@/db/schema/invoices";
import { type DougsInvoiceLine, dougsLine } from "./dougs-lines";
import { buildMilestoneDougsLine } from "./milestones-math";

/** Contexte de rendu d'une facture, tous kinds confondus. */
export type InvoiceContext = {
  /** Libellé local de la facture (ex. « T3 2026 », « Acompte 40 % »). */
  label: string;
  amountHt: number;
  vatRate: number;
  /** Nom affichable du destinataire (entité en B2B, contact en B2C). */
  clientName: string;
  /** Spécifique coworking. */
  periodStart?: string | null;
  periodEnd?: string | null;
  months?: number | null;
  desks?: number | null;
  /** Prix mensuel HT d'un poste. */
  unitPriceHt?: number | null;
  /** Spécifique jalon projet. */
  projectName?: string | null;
  milestonePercent?: number | null;
};

/**
 * Champs du document Dougs qu'une marque reprend à son compte.
 *
 * Convention : **clé absente = on garde la valeur de Dougs**, clé présente =
 * on l'écrase. C'est ce qui permet de ne toucher qu'au nécessaire et de
 * laisser intacts l'IBAN, les pénalités de retard et les mentions légales de
 * l'émetteur (SIRET, RCS, capital), qui ne dépendent pas de la marque.
 *
 * Sans ces surcharges, toute facture hérite des réglages Dougs globaux, calés
 * pour les devis Automato : un coworker recevait une facture sous-titrée
 * « Automato est une marque du groupe Parade », parlant de coûts d'appels LLM
 * et de validité de devis.
 */
export type DocumentOverrides = {
  /** Lignes affichées sous l'identité de l'émetteur. */
  invoicerOthers?: string[];
  /** Note de bas de document. `null` l'efface. */
  thankYouNote?: string | null;
  /** Modalités de paiement (`legalData.paymentTerms`). */
  paymentTerms?: string;
  /** Pénalités de retard. Omis = on garde la formulation légale de Dougs. */
  latePaymentTerms?: string;
  /** Mentions additionnelles du pied (`footerData.others`). */
  footerOthers?: string[];
  /** Calcul d'échéance côté Dougs, ex. `DAYS_30`. */
  dueDateOption?: string;
  /**
   * Logo du document (`logoUuid`).
   *
   * Épinglé explicitement pour chaque marque, et pas laissé au défaut de la
   * société : ce défaut est **global**, donc le changer depuis les réglages
   * Dougs repeint toutes les factures de toutes les marques d'un coup. C'est
   * exactement ce qui s'est produit le 2026-10-05.
   *
   * Un UUID s'obtient en téléversant l'image chez Dougs
   * (`POST /companies/{id}/attachments?filename=…&type=invoicingLogo`,
   * multipart, champ `file`).
   */
  logoUuid?: string;
};

export type BrandTemplate = {
  brand: InvoiceBrand;
  /** Libellé affiché dans l'UI. */
  label: string;
  /** TVA par défaut appliquée aux factures de cette marque, en décimal. */
  defaultVatRate: number;
  /** Objet de la facture, tel qu'il apparaît en tête du document Dougs. */
  invoiceSubject: (ctx: InvoiceContext) => string;
  buildLines: (ctx: InvoiceContext) => DougsInvoiceLine[];
  /** Conditions de paiement, à poser sur le `legalData` Dougs. */
  paymentTerms: string;
  /** Mention de pied propre à la marque, `null` si rien à ajouter. */
  footerNote: string | null;
  /**
   * Mail d'accompagnement envoyé avec la facture.
   *
   *  - `html` : ce que le client reçoit, puisque c'est Parade OS qui envoie
   *    (Resend) avec le PDF légal de Dougs en pièce jointe.
   *  - `body` : la version texte, qui sert de `text/plain` et de repli si on
   *    doit passer par `actions/send-email` de Dougs, qui n'accepte que du
   *    texte brut.
   */
  email: (ctx: InvoiceContext) => { subject: string; body: string; html: string };
  /** Nom affiché de l'expéditeur du mail client. */
  senderName: string;
  /** Jours après l'échéance où une relance est attendue. */
  reminderCadenceDays: number[];
  /** Ce que la marque impose au document Dougs. */
  document: DocumentOverrides;
};

/**
 * Gabarit des mails adressés aux clients. Volontairement distinct de
 * `emailLayout` de `lib/email/client.ts`, qui habille les mails internes aux
 * couleurs de l'app (« Parade OS ») : un client n'a pas à voir le nom de notre
 * outil interne, il doit voir la marque qui le facture.
 *
 * Styles en ligne et tableau de synthèse : c'est ce qui survit aux clients mail.
 */
function clientEmailLayout(args: {
  brandLabel: string;
  intro: string;
  rows: [string, string][];
  outro: string[];
  signature: string;
}): string {
  const rows = args.rows
    .map(
      ([k, v]) =>
        `<tr>
           <td style="padding:6px 16px 6px 0;color:#6b7280;font-size:13px;white-space:nowrap;">${escapeHtml(k)}</td>
           <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${escapeHtml(v)}</td>
         </tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:24px 12px;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;">
    <tr><td style="padding:24px 24px 0 24px;">
      <p style="margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">${escapeHtml(args.brandLabel)}</p>
    </td></tr>
    <tr><td style="padding:16px 24px 0 24px;color:#111827;font-size:14px;line-height:1.55;">
      <p style="margin:0 0 16px 0;">${escapeHtml(args.intro)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;border-top:1px solid #f3f4f6;border-bottom:1px solid #f3f4f6;">
        ${rows}
      </table>
      ${args.outro.map((p) => `<p style="margin:0 0 12px 0;">${escapeHtml(p)}</p>`).join("")}
      <p style="margin:16px 0 0 0;color:#6b7280;font-size:13px;">${escapeHtml(args.signature)}</p>
    </td></tr>
    <tr><td style="padding:20px 24px 24px 24px;">
      <p style="margin:0;color:#9ca3af;font-size:11px;">La facture est jointe à ce message au format PDF.</p>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatEur(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

/** `2026-09-30` → `30/09/2026`. Laisse passer tel quel ce qui n'est pas une date ISO. */
function formatFrDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const COWORKING: BrandTemplate = {
  brand: "coworking",
  label: "La Cachette",
  defaultVatRate: 0.2,
  invoiceSubject: (ctx) => `Hébergement coworking — ${ctx.label}`,
  buildLines: (ctx) => {
    const desks = ctx.desks ?? 1;
    const months = ctx.months ?? 1;
    const monthlyHt = ctx.unitPriceHt ?? 0;
    return [
      dougsLine({
        title: "Prestation d'hébergement",
        description: `${desks} poste${desks > 1 ? "s" : ""} × ${monthlyHt.toLocaleString("fr-FR")} €/mois × ${months} mois (${ctx.periodStart} → ${ctx.periodEnd})`,
        unit: "mois",
        quantity: months,
        unitAmount: desks * monthlyHt,
        vatRate: ctx.vatRate,
      }),
    ];
  },
  paymentTerms: "Paiement à 15 jours à réception de facture, par virement bancaire.",
  footerNote: null,
  senderName: "La Cachette",
  email: (ctx) => ({
    subject: `Votre facture d'hébergement — ${ctx.label}`,
    html: clientEmailLayout({
      brandLabel: "La Cachette",
      intro: "Bonjour, voici votre facture d'hébergement pour la période à venir.",
      rows: [
        ["Période", `${formatFrDate(ctx.periodStart)} au ${formatFrDate(ctx.periodEnd)}`],
        [
          "Postes",
          `${ctx.desks ?? 1} poste${(ctx.desks ?? 1) > 1 ? "s" : ""} × ${formatEur(ctx.unitPriceHt ?? 0)} / mois`,
        ],
        ["Montant HT", formatEur(ctx.amountHt)],
        ["Total TTC", formatEur(ctx.amountHt * (1 + ctx.vatRate))],
      ],
      outro: [
        "Le règlement est attendu sous 15 jours par virement bancaire ; les coordonnées figurent sur la facture.",
        "Pour toute question, répondez simplement à ce message.",
      ],
      signature: "L'équipe La Cachette",
    }),
    body: [
      "Bonjour,",
      "",
      `Vous trouverez ci-joint votre facture d'hébergement pour la période du ${formatFrDate(ctx.periodStart)} au ${formatFrDate(ctx.periodEnd)}, d'un montant de ${formatEur(ctx.amountHt * (1 + ctx.vatRate))} TTC.`,
      "",
      "Le règlement est attendu sous 15 jours par virement bancaire, les coordonnées figurent sur la facture.",
      "",
      "Pour toute question, répondez simplement à ce message.",
      "",
      "Bien à vous,",
      "L'équipe La Cachette",
    ].join("\n"),
  }),
  reminderCadenceDays: [7, 21, 45],
  document: {
    invoicerOthers: ["La Cachette est une marque de Parade SAS"],
    // Le défaut Dougs parle de coûts de pipeline LLM et de validité de devis :
    // absurde sur une facture d'hébergement.
    thankYouNote: null,
    paymentTerms: "Paiement à 15 jours à réception de facture, par virement bancaire.",
    // La ligne de pied par défaut renvoie aux CGPS d'Automato et évoque la
    // signature d'un devis : rien à voir avec un contrat de coworking.
    footerOthers: [],
    // Un abonnement se règle sur la période qu'il couvre, pas 30 jours après.
    dueDateOption: "DAYS_15",
    // « la_cachette_space.jpeg », téléversé le 2026-10-05. À confirmer sur un
    // brouillon : c'est le logo qui doit apparaître sur les factures du lieu.
    logoUuid: "cd5ac84f-34f4-4bcb-b653-3fa9aa7b87ff",
  },
};

const AUTOMATO: BrandTemplate = {
  brand: "automato",
  label: "Automato",
  defaultVatRate: 0.2,
  invoiceSubject: (ctx) => (ctx.projectName ? `${ctx.projectName} — ${ctx.label}` : ctx.label),
  buildLines: (ctx) => [
    buildMilestoneDougsLine({
      label: ctx.label,
      milestonePercent: ctx.milestonePercent ?? null,
      amountHt: ctx.amountHt,
      vatRate: ctx.vatRate,
      projectName: ctx.projectName ?? ctx.clientName,
    }),
  ],
  paymentTerms: "Paiement à 30 jours date de facture, par virement bancaire.",
  footerNote: null,
  senderName: "Automato",
  email: (ctx) => ({
    subject: ctx.projectName ? `Facture ${ctx.label} — ${ctx.projectName}` : `Facture ${ctx.label}`,
    html: clientEmailLayout({
      brandLabel: "Automato",
      intro: ctx.projectName
        ? `Bonjour, voici la facture ${ctx.label} relative au projet « ${ctx.projectName} ».`
        : `Bonjour, voici la facture ${ctx.label}.`,
      rows: [
        ...(ctx.projectName ? ([["Projet", ctx.projectName]] as [string, string][]) : []),
        ...(ctx.milestonePercent != null
          ? ([["Jalon", `${ctx.milestonePercent} % du projet`]] as [string, string][])
          : []),
        ["Montant HT", formatEur(ctx.amountHt)],
        ["Total TTC", formatEur(ctx.amountHt * (1 + ctx.vatRate))],
      ],
      outro: ["Le règlement est attendu sous 30 jours par virement bancaire."],
      signature: "L'équipe Automato",
    }),
    body: [
      "Bonjour,",
      "",
      `Vous trouverez ci-joint la facture ${ctx.label}${ctx.projectName ? ` relative au projet « ${ctx.projectName} »` : ""}, d'un montant de ${formatEur(ctx.amountHt * (1 + ctx.vatRate))} TTC.`,
      "",
      "Le règlement est attendu sous 30 jours par virement bancaire.",
      "",
      "Bien à vous,",
      "L'équipe Automato",
    ].join("\n"),
  }),
  reminderCadenceDays: [7, 21, 45],
  // Rien à surcharger côté mentions : les réglages Dougs globaux sont déjà
  // ceux d'Automato (sous-titre, CGPS, note de remerciement). On explicite en
  // revanche l'échéance, pour ne pas dépendre d'un défaut Dougs qu'un
  // changement de réglage pourrait déplacer sans qu'on le voie.
  document: {
    dueDateOption: "DAYS_30",
    // Logo historique, celui qui servait de défaut société avant le
    // 2026-10-05. L'épingler protège la prestation d'un changement de défaut
    // décidé pour une autre marque.
    logoUuid: "98426423-a3a5-4416-bd40-a48898585247",
  },
};

const PARADE: BrandTemplate = {
  brand: "parade",
  label: "Parade",
  defaultVatRate: 0.2,
  invoiceSubject: (ctx) => ctx.label,
  buildLines: (ctx) => [
    dougsLine({
      title: ctx.label,
      description: "",
      unit: "forfait",
      quantity: 1,
      unitAmount: ctx.amountHt,
      vatRate: ctx.vatRate,
    }),
  ],
  paymentTerms: "Paiement à 30 jours date de facture, par virement bancaire.",
  footerNote: null,
  senderName: "Parade",
  email: (ctx) => ({
    subject: `Facture ${ctx.label}`,
    html: clientEmailLayout({
      brandLabel: "Parade",
      intro: `Bonjour, voici la facture « ${ctx.label} ».`,
      rows: [
        ["Montant HT", formatEur(ctx.amountHt)],
        ["Total TTC", formatEur(ctx.amountHt * (1 + ctx.vatRate))],
      ],
      outro: ["Le règlement est attendu sous 30 jours par virement bancaire."],
      signature: "L'équipe Parade",
    }),
    body: [
      "Bonjour,",
      "",
      `Vous trouverez ci-joint la facture « ${ctx.label} », d'un montant de ${formatEur(ctx.amountHt * (1 + ctx.vatRate))} TTC.`,
      "",
      "Le règlement est attendu sous 30 jours par virement bancaire.",
      "",
      "Bien à vous,",
      "L'équipe Parade",
    ].join("\n"),
  }),
  reminderCadenceDays: [7, 21, 45],
  document: {
    // Parade **est** l'entité juridique : un sous-titre « X est une marque de
    // Parade SAS » n'aurait aucun sens, et le pied de page porte déjà
    // l'identité légale complète. On vide donc le sous-titre plutôt que de
    // laisser celui d'Automato, que Dougs applique par défaut.
    invoicerOthers: [],
    // Le défaut Dougs parle de coûts de pipeline LLM et de validité de devis :
    // hors sujet sur une facture Parade.
    thankYouNote: null,
    paymentTerms: "Paiement à 30 jours date de facture, par virement bancaire.",
    // La ligne de pied par défaut renvoie aux CGPS d'Automato et évoque la
    // signature d'un devis.
    footerOthers: [],
    dueDateOption: "DAYS_30",
    // Même logo qu'Automato : Parade et Automato partagent leur identité
    // visuelle, seule La Cachette a la sienne.
    logoUuid: "98426423-a3a5-4416-bd40-a48898585247",
  },
};

const TEMPLATES: Record<InvoiceBrand, BrandTemplate> = {
  coworking: COWORKING,
  automato: AUTOMATO,
  parade: PARADE,
};

export function brandTemplateFor(brand: InvoiceBrand): BrandTemplate {
  return TEMPLATES[brand] ?? PARADE;
}

/** Libellés pour l'UI, dans l'ordre d'affichage. */
export const INVOICE_BRAND_LABELS: Record<InvoiceBrand, string> = {
  parade: PARADE.label,
  coworking: COWORKING.label,
  automato: AUTOMATO.label,
};

/**
 * Marque déduite à la création d'une facture. Le coworking est porté par son
 * contrat ; devis et jalons relèvent de la prestation client, donc d'Automato.
 * Le reste (`one_off`, avoirs sans facture liée) tombe sur `parade` et se
 * corrige à la main — c'est le fourre-tout assumé, pas une erreur.
 */
export function brandForInvoice(row: {
  kind: InvoiceKind;
  coworkingContractId?: string | null;
}): InvoiceBrand {
  if (row.kind === "coworking" || row.coworkingContractId) return "coworking";
  if (row.kind === "quote" || row.kind === "milestone") return "automato";
  return "parade";
}
