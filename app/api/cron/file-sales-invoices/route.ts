import { coworkingContracts } from "@/db/schema/coworking";
import { dougsSessions } from "@/db/schema/dougs";
import { entities } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import {
  fileSalesInvoiceToDrive,
  getSalesInvoiceFolderId,
} from "@/lib/billing/file-invoice-to-drive";
import { cronResponse, cronUnauthorized } from "@/lib/cron/auth";
import { db } from "@/lib/db/server";
import {
  DougsAuthError,
  downloadDougsFile,
  getDougsSalesInvoice,
  pickDougsFileUuid,
  pickDougsReference,
} from "@/lib/dougs/client";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";

/**
 * Classe dans le Drive comptable les factures de vente émises dont le PDF n'y
 * est pas encore.
 *
 * Deux usages :
 *  - **rattrapage** du stock historique, émis avant que le classement existe
 *    ou directement depuis Dougs, donc sans passer par notre envoi ;
 *  - **filet** permanent : une facture finalisée à la main dans Dougs ne
 *    déclenche aucun envoi de notre côté, elle serait sinon jamais classée.
 *
 * Le PDF est récupéré chez Dougs, pas reconstruit : c'est bien le document
 * légal qui atterrit dans le Drive.
 *
 * Idempotent : `drive_file_id` non nul fait sortir chaque facture, donc
 * rejouer le job ne produit pas de doublon.
 *
 * Auth : `Authorization: Bearer <CRON_SECRET>`.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Chaque facture coûte deux appels Dougs (lecture + téléchargement du PDF) et
 * un envoi Drive. 25 tiennent dans les 300 s avec de la marge, et le reliquat
 * part au run suivant — la file étant triée, elle finit toujours par se vider.
 */
const BATCH_SIZE = 25;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function GET(request: Request) {
  const unauthorized = cronUnauthorized(request);
  if (unauthorized) return unauthorized;

  const conn = await db();

  const folderId = await getSalesInvoiceFolderId();
  if (!folderId) {
    return cronResponse({
      failed: 0,
      skipped: "Dossier Drive non configuré (SALES_INVOICE_DRIVE_FOLDER_ID).",
    });
  }

  const [session] = await conn
    .select({ userId: dougsSessions.userId })
    .from(dougsSessions)
    .orderBy(desc(dougsSessions.updatedAt))
    .limit(1);
  if (!session) {
    return cronResponse({ failed: 1, errors: ["Aucune session Dougs connectée."] });
  }

  // Le nom du client vient du projet ou du contrat selon le kind : les deux
  // jointures sont nullables, on prend la première qui répond.
  const queue = await conn
    .select({
      id: invoices.id,
      label: invoices.label,
      reference: invoices.dougsReference,
      dougsInvoiceId: invoices.dougsInvoiceId,
      entityName: entities.name,
      entityLegalName: entities.legalName,
      contractName: coworkingContracts.name,
      projectName: projects.name,
    })
    .from(invoices)
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
    .leftJoin(
      entities,
      // `or` de Drizzle, pas `||` de JavaScript : avec `||` la seconde
      // condition serait silencieusement ignorée et les factures coworking
      // facturées à une entité perdraient leur nom de client.
      or(eq(entities.id, projects.entityId), eq(entities.id, coworkingContracts.billToEntityId)),
    )
    .where(
      and(
        inArray(invoices.kind, ["coworking", "milestone", "one_off"]),
        inArray(invoices.status, ["sent", "paid"]),
        isNull(invoices.driveFileId),
        isNotNull(invoices.dougsInvoiceId),
      ),
    )
    .orderBy(asc(invoices.invoicedAt))
    .limit(BATCH_SIZE);

  const filed: Array<{ label: string; filename: string }> = [];
  const skipped: Array<{ label: string; reason: string }> = [];
  const errors: Array<{ label: string; message: string }> = [];

  for (const item of queue) {
    if (!item.dougsInvoiceId) continue;
    try {
      const fresh = await getDougsSalesInvoice(session.userId, item.dougsInvoiceId);
      const fileUuid = pickDougsFileUuid(fresh);
      if (!fileUuid) {
        // Arrive sur une facture dont Dougs n'a pas (encore) produit le PDF.
        skipped.push({ label: item.label, reason: "PDF absent chez Dougs" });
        continue;
      }
      const pdf = await downloadDougsFile(session.userId, fileUuid);
      const res = await fileSalesInvoiceToDrive({
        userId: session.userId,
        invoiceId: item.id,
        reference: item.reference ?? pickDougsReference(fresh) ?? item.dougsInvoiceId,
        clientName:
          item.entityLegalName ?? item.entityName ?? item.contractName ?? item.projectName ?? "",
        pdf: pdf.buffer,
      });
      if (res.filed) {
        filed.push({ label: item.label, filename: res.filename });
      } else if (res.reason === "error") {
        errors.push({ label: item.label, message: res.message });
      } else {
        skipped.push({ label: item.label, reason: res.reason });
      }
    } catch (err) {
      // Cookie expiré : inutile d'insister sur le reste du lot.
      if (err instanceof DougsAuthError) {
        errors.push({ label: item.label, message: err.message });
        break;
      }
      errors.push({
        label: item.label,
        message: err instanceof Error ? err.message : "erreur inconnue",
      });
    }
    await sleep(150);
  }

  return cronResponse({
    queued: queue.length,
    filed,
    skipped,
    errors,
    failed: errors.length,
  });
}
