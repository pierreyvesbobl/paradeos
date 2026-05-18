"use server";

import { contacts as contactsTable } from "@/db/schema/contacts";
import { entities as entitiesTable } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  DougsApiError,
  DougsAuthError,
  createDougsSalesInvoiceDraft,
  getDougsDraftUrl,
  searchDougsClients,
  updateDougsSalesInvoice,
} from "@/lib/dougs/client";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
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
        entitySiren: entitiesTable.siren,
        entityVatNumber: entitiesTable.vatNumber,
        entityAddress: entitiesTable.address,
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

    // ClientData — pattern identique au push devis/coworking.
    let clientData: Record<string, unknown>;
    try {
      const matches = await searchDougsClients(user.id, row.entityName, true);
      const best = matches[0];
      if (best) {
        clientData = {
          isBToB: best.isBtoB,
          legalName: best.legalName ?? best.name,
          siren: best.siren,
          siret: null,
          vatNumber: best.vatNumber,
          firstName: best.firstName,
          lastName: best.lastName,
          address: best.address
            ? {
                street: best.address.street ?? "",
                zipCode: best.address.zipcode ?? "",
                city: best.address.city ?? "",
                country: "France",
              }
            : { street: "", zipCode: "", city: "", country: "France" },
          deliveryAddress: { street: "", zipCode: "", city: "", country: "" },
          others: [],
          email: best.email ?? row.contactEmail ?? null,
          phone: best.phone ?? null,
          clientId: best.clientId,
        };
      } else {
        const localAddr = row.entityAddress as {
          street?: string;
          postalCode?: string;
          city?: string;
          country?: string;
        } | null;
        clientData = {
          isBToB: true,
          legalName: row.entityName,
          siren: row.entitySiren ?? null,
          siret: null,
          vatNumber: row.entityVatNumber ?? null,
          firstName: null,
          lastName: null,
          address: {
            street: localAddr?.street ?? "",
            zipCode: localAddr?.postalCode ?? "",
            city: localAddr?.city ?? "",
            country: localAddr?.country ?? "France",
          },
          deliveryAddress: { street: "", zipCode: "", city: "", country: "" },
          others: [],
          email: row.contactEmail ?? null,
          phone: null,
          clientId: null,
        };
      }
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      if (err instanceof DougsApiError) {
        throw new Error(`Recherche client Dougs : ${err.message}`);
      }
      throw err;
    }

    const description =
      invoice.milestonePercent != null
        ? `${invoice.milestonePercent.toLocaleString("fr-FR")} % du projet "${project.name}".`
        : `Facture liée au projet "${project.name}".`;

    const lines = [
      {
        title: invoice.label,
        description,
        unit: "forfait",
        quantity: 1,
        unitAmount: amountHt,
        vatRate: Number(invoice.vatRate),
        discount: 0,
        discountUnit: "%",
        reference: null,
        amount: amountHt,
        discountInEuros: 0,
        isPriceWithVat: false,
      },
    ];

    let draft: Awaited<ReturnType<typeof createDougsSalesInvoiceDraft>>;
    try {
      draft = await createDougsSalesInvoiceDraft(user.id);
      await updateDougsSalesInvoice(user.id, draft.id, {
        ...draft,
        clientData,
        lines,
      });
    } catch (err) {
      if (err instanceof DougsAuthError) throw err;
      if (err instanceof DougsApiError) {
        throw new Error(`Push Dougs : ${err.message}`);
      }
      throw err;
    }

    await conn
      .update(invoices)
      .set({
        status: "sent",
        invoicedAt: new Date(),
        dougsInvoiceId: draft.id,
        dougsReference: draft.reference,
        dougsStatus: "DRAFT",
        dougsSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, input.invoiceId));

    const url = await getDougsDraftUrl(user.id, draft.id);
    revalidatePath(`/projets/${invoice.projectId}`);
    revalidatePath("/compta");
    return { dougsId: draft.id, reference: draft.reference, url };
  },
);
