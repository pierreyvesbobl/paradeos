import { coworkingContracts } from "@/db/schema/coworking";
import { dougsSessions } from "@/db/schema/dougs";
import { invoices } from "@/db/schema/invoices";
import { getAppUrl } from "@/lib/app-url";
import {
  type AutoSendSkipReason,
  autoSendCoworkingInvoice,
  isCoworkingAutoSendEnabled,
} from "@/lib/coworking/auto-send";
import { generateNextInvoiceForContract } from "@/lib/coworking/generate-invoice";
import { cronResponse, cronUnauthorized } from "@/lib/cron/auth";
import { db } from "@/lib/db/server";
import { DougsAuthError } from "@/lib/dougs/client";
import { sendEmail } from "@/lib/email/client";
import { renderCoworkingAutoSendDigestEmail } from "@/lib/email/templates";
import { getUserEmails } from "@/lib/email/users";
import { and, asc, desc, eq, isNotNull, isNull, or } from "drizzle-orm";

/**
 * Cron mensuel du coworking, en deux passes.
 *
 * 1. Génération : crée une facture `draft` pour chaque contrat `en_cours`
 *    dont la période suivante est due. Idempotent — si la facture du mois
 *    existe déjà (bouton manuel ou run précédent), la période calculée
 *    tomberait dans le futur et le helper la skip. L'index unique
 *    `invoices_coworking_period_uidx` est le garde-fou de dernier recours.
 *
 * 2. Envoi automatique : pousse sur Dougs, finalise et envoie par mail les
 *    factures des contrats qui ont coché `auto_send`. Balaie toutes les
 *    factures coworking encore en `draft` et jamais envoyées, pas seulement
 *    celles que la passe 1 vient de créer — un run raté se rattrape donc au
 *    run suivant.
 *
 * Pas d'entrée cron dédiée : le plan Vercel Hobby limite la fréquence, donc
 * la seconde passe est greffée sur le cron existant (`0 6 1 * *`).
 *
 * `?dryRun=1` exécute la passe 2 jusqu'au contrôle `can-finalize` puis
 * supprime le brouillon. C'est le seul moyen de valider la chaîne contre le
 * vrai Dougs sans émettre de facture.
 *
 * Auth : `Authorization: Bearer <CRON_SECRET>`. Vercel pose le header
 * automatiquement quand `CRON_SECRET` est défini.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Borne la passe d'envoi. Chaque facture coûte jusqu'à 5 appels Dougs
 * (recherche, création, update, can-finalize, finalize, relecture, mail), à
 * 8-20 s de timeout chacun : 25 factures tiennent dans les 300 s même si
 * Dougs est lent, et le reliquat passe au run suivant.
 */
const AUTOSEND_BATCH_SIZE = 25;

/** Les raisons de ne pas envoyer qui ne méritent pas d'apparaître dans le récap. */
const QUIET_REASONS: AutoSendSkipReason[] = ["not_opted_in", "disabled", "g_and_o"];

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function GET(request: Request) {
  const unauthorized = cronUnauthorized(request);
  if (unauthorized) return unauthorized;

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const conn = await db();
  const today = new Date();

  // ---------------------------------------------------------------------
  // Passe 1 — génération
  // ---------------------------------------------------------------------
  const ongoing = await conn
    .select({ id: coworkingContracts.id, name: coworkingContracts.name })
    .from(coworkingContracts)
    .where(eq(coworkingContracts.status, "en_cours"));

  const created: Array<{ contractName: string; period: string }> = [];
  const skipped: Array<{ contractName: string; reason: string }> = [];
  const errors: Array<{ contractName: string; message: string }> = [];

  for (const c of ongoing) {
    const res = await generateNextInvoiceForContract({
      contractId: c.id,
      today,
      forceFuture: false,
    });
    if (!res.ok) {
      errors.push({ contractName: c.name, message: res.message });
      continue;
    }
    if (res.created) {
      created.push({ contractName: c.name, period: `${res.periodStart} → ${res.periodEnd}` });
    } else {
      skipped.push({ contractName: c.name, reason: res.reason });
    }
  }

  // ---------------------------------------------------------------------
  // Passe 2 — envoi automatique
  // ---------------------------------------------------------------------
  const sent: Array<{ contractName: string; label: string; reference: string; to: string[] }> = [];
  const blocked: Array<{ contractName: string; label: string; blockers: string[] }> = [];
  const notSent: Array<{ contractName: string; label: string; reason: string }> = [];
  const sendErrors: Array<{ contractName: string; label: string; message: string }> = [];
  let autoSend: { enabled: boolean; ran: boolean; note?: string };
  /** Propriétaire de la session Dougs utilisée — c'est lui qui reçoit le récap. */
  let sessionUserId: string | null = null;

  const enabled = await isCoworkingAutoSendEnabled();
  if (!enabled) {
    autoSend = { enabled: false, ran: false, note: "COWORKING_AUTOSEND_ENABLED n'est pas à true." };
  } else {
    // Les factures n'ont pas de propriétaire Dougs : on emprunte la session la
    // plus récemment rafraîchie, comme `sync-dougs-status`. L'extension Chrome
    // la met à jour toutes les heures quand Chrome tourne.
    const [session] = await conn
      .select({ userId: dougsSessions.userId })
      .from(dougsSessions)
      .orderBy(desc(dougsSessions.updatedAt))
      .limit(1);

    if (!session) {
      autoSend = {
        enabled: true,
        ran: false,
        note: "Aucune session Dougs connectée — rien n'a été poussé.",
      };
      errors.push({
        contractName: "—",
        message: "Envoi auto impossible : aucune session Dougs. Reconnecte le cookie.",
      });
    } else {
      const queue = await conn
        .select({
          id: invoices.id,
          label: invoices.label,
          contractName: coworkingContracts.name,
        })
        .from(invoices)
        .innerJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
        .where(
          and(
            eq(invoices.kind, "coworking"),
            isNull(invoices.autoSentAt),
            eq(coworkingContracts.autoSend, true),
            or(
              // À pousser, finaliser et envoyer.
              eq(invoices.status, "draft"),
              // Déjà émise chez Dougs mais le mail n'est pas parti (échec de
              // `send-email`, ou finalisation à la main dans Dougs). Sans cette
              // branche la facture quitte la file au moment où elle passe à
              // `sent` et plus rien ne la rattrape. `dougs_invoice_id` non nul
              // est la condition qui distingue ce cas d'une facture que
              // quelqu'un a simplement marquée « envoyée » à la main, et qu'il
              // ne faut surtout pas facturer une seconde fois.
              and(eq(invoices.status, "sent"), isNotNull(invoices.dougsInvoiceId)),
            ),
          ),
        )
        .orderBy(asc(invoices.periodStart))
        .limit(AUTOSEND_BATCH_SIZE);

      autoSend = { enabled: true, ran: true };
      sessionUserId = session.userId;

      for (const item of queue) {
        try {
          const res = await autoSendCoworkingInvoice({
            userId: session.userId,
            invoiceId: item.id,
            dryRun,
            enabled: true,
          });
          if (!res.ok) {
            sendErrors.push({
              contractName: item.contractName,
              label: item.label,
              message: res.message,
            });
          } else if (res.sent) {
            sent.push({
              contractName: item.contractName,
              label: item.label,
              reference: res.reference,
              to: res.to,
            });
          } else if (res.reason === "blockers") {
            blocked.push({
              contractName: item.contractName,
              label: item.label,
              blockers: (res.blockers ?? []).map((b) => `${b.field} : ${b.message}`),
            });
          } else if (!QUIET_REASONS.includes(res.reason)) {
            notSent.push({
              contractName: item.contractName,
              label: item.label,
              reason: res.reason,
            });
          }
        } catch (err) {
          // Cookie expiré : inutile d'insister sur les 24 factures suivantes.
          if (err instanceof DougsAuthError) {
            autoSend = { enabled: true, ran: true, note: err.message };
            errors.push({ contractName: "—", message: `Envoi auto interrompu : ${err.message}` });
            break;
          }
          sendErrors.push({
            contractName: item.contractName,
            label: item.label,
            message: err instanceof Error ? err.message : "erreur inconnue",
          });
        }
        await sleep(150);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Récap à l'équipe — uniquement s'il y a quelque chose à dire.
  // ---------------------------------------------------------------------
  const worthReporting = sent.length + blocked.length + sendErrors.length > 0;
  if (worthReporting && !dryRun && sessionUserId) {
    // Le récap part au propriétaire de la session Dougs : c'est son compte qui
    // a émis les factures, et lui qui peut agir sur les blocages.
    const emails = await getUserEmails([sessionUserId]);
    const to = emails[sessionUserId];
    if (to) {
      const digest = renderCoworkingAutoSendDigestEmail({
        appUrl: await getAppUrl(),
        sent,
        blocked,
        errors: sendErrors,
      });
      await sendEmail({
        to,
        subject: digest.subject,
        html: digest.html,
        text: digest.text,
        tags: [{ name: "type", value: "coworking-autosend" }],
      });
    } else {
      console.warn("[cron coworking] pas d'email pour la session Dougs — récap non expédié.");
    }
  }

  const failed = errors.length + sendErrors.length + blocked.length;
  return cronResponse({
    ranAt: today.toISOString(),
    dryRun,
    contracts: ongoing.length,
    succeeded: created.length + skipped.length,
    failed,
    created,
    skipped,
    errors,
    autoSend,
    sent,
    blocked,
    notSent,
    sendErrors,
  });
}
