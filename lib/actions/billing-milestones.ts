"use server";

import { contacts as contactsTable } from "@/db/schema/contacts";
import { entities as entitiesTable } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { action } from "@/lib/actions/action";
import { dueDateFrom } from "@/lib/billing/billing-terms";
import { resolveInvoiceDocument } from "@/lib/billing/brand-documents";
import { brandTemplateFor } from "@/lib/billing/brand-templates";
import { pushDougsSalesInvoiceDraft, resolveDougsClientData } from "@/lib/billing/dougs-push";
import { db } from "@/lib/db/server";
import { getDougsDraftUrl } from "@/lib/dougs/client";
import { eq } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";

/**
 * Pousse un jalon projet vers Dougs en tant que brouillon facture.
 * `invoiceId` = id de l'invoice (kind='milestone') côté Paradeos.
 *
 * Crée le draft Dougs et stocke `dougs_invoice_id` sur l'invoice. Le
 * statut local passe à 'sent'. Ne finalise pas — PY valide depuis Dougs.
 */
export const pushProjectMilestoneToDougs = action(
  z.object({ invoiceId: z.string().uuid() }),
  async ({ input, user }) => {
    const conn = await db();
    const [row] = await conn
      .select({
        invoice: invoices,
        project: projects,
        entityName: entitiesTable.name,
        entityLegalName: entitiesTable.legalName,
        entitySiren: entitiesTable.siren,
        entitySiret: entitiesTable.siret,
        entityVatNumber: entitiesTable.vatNumber,
        entityAddress: entitiesTable.address,
        entityDeliveryAddress: entitiesTable.deliveryAddress,
        projectBillingTerms: projects.billingTerms,
        contactEmail: contactsTable.email,
      })
      .from(invoices)
      .leftJoin(projects, eq(projects.id, invoices.projectId))
      .leftJoin(entitiesTable, eq(entitiesTable.id, projects.entityId))
      .leftJoin(contactsTable, eq(contactsTable.id, projects.contactId))
      .where(eq(invoices.id, input.invoiceId))
      .limit(1);

    if (!row || !row.project) throw new Error("Jalon introuvable.");
    const { invoice, project } = row;
    if (invoice.kind !== "milestone") {
      throw new Error("Cette facture n'est pas un jalon projet.");
    }
    if (project.kind !== "client") {
      throw new Error("Facturation Dougs disponible uniquement pour les projets 'client'.");
    }
    if (!project.entityId || !row.entityName) {
      throw new Error("Entité de facturation manquante sur le projet.");
    }
    const amountHt = Number(invoice.amountHt);
    if (amountHt <= 0) throw new Error("Montant du jalon = 0.");

    const clientData = await resolveDougsClientData({
      userId: user.id,
      isBtoB: true,
      searchName: row.entityName,
      local: {
        legalName: row.entityLegalName ?? row.entityName,
        siren: row.entitySiren ?? null,
        siret: row.entitySiret ?? null,
        vatNumber: row.entityVatNumber ?? null,
        address: row.entityAddress,
        deliveryAddress: row.entityDeliveryAddress,
        email: row.contactEmail ?? null,
      },
    });

    const template = brandTemplateFor(invoice.brand);
    // Conditions négociées sur ce projet, par-dessus les défauts de la marque.
    const terms = await resolveInvoiceDocument(invoice.brand, row.projectBillingTerms);
    const ctx = {
      label: invoice.label,
      amountHt,
      vatRate: Number(invoice.vatRate),
      clientName: row.entityName,
      projectName: project.name,
      milestonePercent: invoice.milestonePercent,
    };

    const draft = await pushDougsSalesInvoiceDraft({
      userId: user.id,
      clientData,
      lines: template.buildLines(ctx),
      subject: template.invoiceSubject(ctx),
      document: terms.document,
    });

    // Le push vaut émission pour un jalon : on pose l'échéance avec le délai
    // de la marque, comme le ferait `setInvoiceStatus`. Sans ça la facture
    // arrivait dans les relances sans date d'échéance.
    const invoicedAt = new Date();
    await conn
      .update(invoices)
      .set({
        status: "sent",
        invoicedAt,
        dueDate: invoice.dueDate ?? toIsoDate(dueDateFrom(invoicedAt, terms.dueDays)),
        dougsInvoiceId: draft.id,
        dougsReference: draft.reference,
        dougsStatus: "DRAFT",
        dougsSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, input.invoiceId));

    const url = await getDougsDraftUrl(user.id, draft.id);
    revalidateTag(`dougs:${user.id}`);
    revalidatePath(`/projets/${invoice.projectId}`);
    revalidatePath("/compta");
    return { dougsId: draft.id, reference: draft.reference, url };
  },
);

/** `invoices.due_date` est une colonne `date`, pas un timestamp. */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
