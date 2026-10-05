/**
 * Gardes de l'envoi automatique des factures coworking. Module pur — pas de
 * DB, pas d'API, pas de `server-only`, justement pour qu'il soit testable.
 *
 * C'est la seule chose qui empêche une facture définitive de partir chez un
 * client par erreur, et une facture finalisée ne s'annule que par un avoir.
 */

/** Raison pour laquelle une facture n'a pas été envoyée. Aucune n'est une erreur. */
export type AutoSendSkipReason =
  /** Réglage global `COWORKING_AUTOSEND_ENABLED` absent ou à "false". */
  | "disabled"
  /** Le contrat n'a pas coché l'envoi automatique. */
  | "not_opted_in"
  /** Facturée par G&O, ce n'est pas Parade qui émet. */
  | "g_and_o"
  /** Aucune adresse mail où envoyer la facture. */
  | "no_recipient"
  /** Montant nul ou négatif. */
  | "zero_amount"
  /** Déjà partie : facture émise **et** mail envoyé. */
  | "already_sent"
  /** Dougs refuse de finaliser : données incomplètes. */
  | "blockers"
  /** Mode à blanc : on s'est arrêté avant la finalisation. */
  | "dry_run";

/**
 * Ce qu'il reste à faire sur une facture.
 *
 *  - `skip`       : rien, et pourquoi.
 *  - `email_only` : la facture est déjà émise et numérotée chez Dougs, mais le
 *                   mail n'est jamais parti. Il ne faut surtout pas finaliser à
 *                   nouveau — ça créerait un second document numéroté pour la
 *                   même période — mais il reste à envoyer le mail.
 *  - `full`       : brouillon → contrôle → finalisation → mail.
 */
export type AutoSendPlan =
  | { kind: "skip"; reason: AutoSendSkipReason }
  | { kind: "email_only" }
  | { kind: "full" };

/**
 * Décide quoi faire d'une facture, sans accès DB — c'est la partie de l'envoi
 * automatique qu'on veut pouvoir tester exhaustivement, puisqu'une garde
 * manquante se traduit par une facture définitive partie chez un client.
 *
 * L'ordre compte : on répond par la raison la plus en amont, celle qu'il faut
 * corriger d'abord.
 */
export function autoSendPlan(args: {
  /** Réglage global. */
  enabled: boolean;
  contractAutoSend: boolean;
  billedBy: string | null;
  /** Posé seulement quand la facture est émise **et** le mail parti. */
  autoSentAt: Date | null;
  /** `null` si jamais poussée ; `DRAFT` tant qu'elle n'est pas finalisée. */
  dougsStatus: string | null;
  amountHt: number;
  recipientEmail: string | null;
}): AutoSendPlan {
  if (!args.enabled) return { kind: "skip", reason: "disabled" };
  if (!args.contractAutoSend) return { kind: "skip", reason: "not_opted_in" };
  // G&O facture en son nom : ce n'est pas à Parade d'émettre.
  if (args.billedBy === "g_and_o") return { kind: "skip", reason: "g_and_o" };
  if (args.autoSentAt) return { kind: "skip", reason: "already_sent" };
  if (!Number.isFinite(args.amountHt) || args.amountHt <= 0) {
    return { kind: "skip", reason: "zero_amount" };
  }
  if (!args.recipientEmail) return { kind: "skip", reason: "no_recipient" };

  // Déjà sortie du brouillon chez Dougs alors que le mail n'est pas parti :
  // soit `send-email` a échoué, soit la facture a été finalisée à la main dans
  // Dougs. Dans les deux cas il reste exactement une chose à faire, et
  // refinaliser n'en fait pas partie.
  const finalised = Boolean(args.dougsStatus) && args.dougsStatus?.toUpperCase() !== "DRAFT";
  if (finalised) return { kind: "email_only" };

  return { kind: "full" };
}
