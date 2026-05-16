import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { contacts as contactsTable } from "../../../db/schema/contacts";
import { coworkingContracts, coworkingInvoices } from "../../../db/schema/coworking";
import { entities as entitiesTable } from "../../../db/schema/entities";
import { type BillingMilestone, projects } from "../../../db/schema/projects";
import { db } from "../../../lib/db/server";
import {
  DougsApiError,
  DougsAuthError,
  createDougsQuoteDraft,
  createDougsSalesInvoiceDraft,
  getDougsDraftUrl,
  getDougsQuoteUrl,
  searchDougsClients,
  updateDougsQuote,
  updateDougsSalesInvoice,
} from "../../../lib/dougs/client";

/**
 * Outils MCP qui orchestrent : push Dougs + stockage du lien Paradeos.
 * Atomicité : si Dougs throw, on n'écrit rien en DB.
 *
 * Pas de revalidatePath — l'agent ne déclenche pas de cache invalidation
 * UI. Le user rafraîchira la page si nécessaire.
 */

// ---------- Helpers internes ----------

async function buildClientDataFromEntity(
  userId: string,
  entityName: string,
  fallbackEntity: {
    siren: string | null;
    vatNumber: string | null;
    address: unknown;
  },
  contactEmail: string | null,
): Promise<Record<string, unknown>> {
  try {
    const matches = await searchDougsClients(userId, entityName, true);
    const best = matches[0];
    if (best) {
      return {
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
        email: best.email ?? contactEmail ?? null,
        phone: best.phone ?? null,
        clientId: best.clientId,
      };
    }
  } catch (err) {
    if (err instanceof DougsAuthError) throw err;
    if (!(err instanceof DougsApiError)) throw err;
  }
  // Fallback : payload depuis l'entité Paradeos.
  const localAddr = fallbackEntity.address as {
    street?: string;
    postalCode?: string;
    city?: string;
    country?: string;
  } | null;
  return {
    isBToB: true,
    legalName: entityName,
    siren: fallbackEntity.siren ?? null,
    siret: null,
    vatNumber: fallbackEntity.vatNumber ?? null,
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
    email: contactEmail ?? null,
    phone: null,
    clientId: null,
  };
}

// ---------- 1. push_project_quote ----------

export const pushProjectQuoteSchema = z.object({
  projectId: z.string().uuid(),
  subject: z.string().trim().max(500).default(""),
  thankYouNote: z.string().trim().max(2000).default(""),
  lines: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        description: z.string().trim().default(""),
        unit: z.string().trim().default("forfait"),
        quantity: z.number().positive(),
        unitAmount: z.number().nonnegative(),
        vatRate: z.number().min(0).max(1).default(0.2),
      }),
    )
    .min(1),
});

export async function pushProjectQuote(
  args: z.infer<typeof pushProjectQuoteSchema>,
  ctx: { userId: string },
) {
  const conn = await db();
  const [row] = await conn
    .select({
      project: projects,
      entityName: entitiesTable.name,
      entitySiren: entitiesTable.siren,
      entityVatNumber: entitiesTable.vatNumber,
      entityAddress: entitiesTable.address,
      contactEmail: contactsTable.email,
    })
    .from(projects)
    .leftJoin(entitiesTable, eq(entitiesTable.id, projects.entityId))
    .leftJoin(contactsTable, eq(contactsTable.id, projects.contactId))
    .where(eq(projects.id, args.projectId))
    .limit(1);
  if (!row) throw new Error(`Projet ${args.projectId} introuvable.`);
  const { project } = row;
  if (project.kind !== "client") {
    throw new Error("Devis disponible uniquement pour les projets kind='client'.");
  }
  if (!project.entityId || !row.entityName) {
    throw new Error("Entité de facturation manquante sur le projet.");
  }

  const clientData = await buildClientDataFromEntity(
    ctx.userId,
    row.entityName,
    {
      siren: row.entitySiren,
      vatNumber: row.entityVatNumber,
      address: row.entityAddress,
    },
    row.contactEmail,
  );

  const lines = args.lines.map((l) => ({
    title: l.title,
    description: l.description,
    unit: l.unit,
    quantity: l.quantity,
    unitAmount: l.unitAmount,
    vatRate: l.vatRate,
    discount: 0,
    discountUnit: "%",
    reference: null,
    amount: Math.round(l.quantity * l.unitAmount * 100) / 100,
    discountInEuros: 0,
    isPriceWithVat: false,
  }));

  const draft = await createDougsQuoteDraft(ctx.userId);
  const updated = await updateDougsQuote(ctx.userId, draft.id, {
    ...draft,
    subject: args.subject,
    thankYouNote: args.thankYouNote,
    clientData,
    lines,
  });

  await conn
    .update(projects)
    .set({
      dougsQuoteId: updated.id,
      dougsQuoteReference: updated.reference,
      dougsQuoteStatus: updated.status ?? "DRAFT",
      dougsQuotePushedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, args.projectId));

  const url = await getDougsQuoteUrl(ctx.userId, updated.id);
  return {
    dougsQuoteId: updated.id,
    reference: updated.reference,
    status: updated.status ?? "DRAFT",
    url,
  };
}

// ---------- 2. push_project_milestone_invoice ----------

export const pushProjectMilestoneInvoiceSchema = z.object({
  projectId: z.string().uuid(),
  /** Si défini : facture l'existant. Sinon : crée un nouveau jalon. */
  milestoneId: z.string().uuid().optional(),
  /** Pour création de jalon : type. Default acompte si percent < 50, solde si > 50, intermediaire sinon. */
  type: z.enum(["acompte", "intermediaire", "solde"]).optional(),
  /** % du montant projet — utilisé pour calculer amountHt si pas fourni. */
  percent: z.number().min(0).max(150).optional(),
  /** Montant HT direct si on ne veut pas passer par %. */
  amountHt: z.number().positive().optional(),
  /** Label du jalon (pour création). */
  label: z.string().trim().max(120).optional(),
});

export async function pushProjectMilestoneInvoice(
  args: z.infer<typeof pushProjectMilestoneInvoiceSchema>,
  ctx: { userId: string },
) {
  const conn = await db();
  const [row] = await conn
    .select({
      project: projects,
      entityName: entitiesTable.name,
      entitySiren: entitiesTable.siren,
      entityVatNumber: entitiesTable.vatNumber,
      entityAddress: entitiesTable.address,
      contactEmail: contactsTable.email,
    })
    .from(projects)
    .leftJoin(entitiesTable, eq(entitiesTable.id, projects.entityId))
    .leftJoin(contactsTable, eq(contactsTable.id, projects.contactId))
    .where(eq(projects.id, args.projectId))
    .limit(1);
  if (!row) throw new Error(`Projet ${args.projectId} introuvable.`);
  const { project } = row;
  if (project.kind !== "client") {
    throw new Error("Facturation Dougs disponible uniquement pour les projets 'client'.");
  }
  if (!project.entityId || !row.entityName) {
    throw new Error("Entité de facturation manquante sur le projet.");
  }

  const milestones = (project.billingMilestones ?? []) as BillingMilestone[];
  let milestone: BillingMilestone | null = null;
  let milestoneIndex = -1;

  if (args.milestoneId) {
    milestoneIndex = milestones.findIndex((m) => m.id === args.milestoneId);
    if (milestoneIndex === -1) throw new Error("Jalon introuvable.");
    milestone = milestones[milestoneIndex] ?? null;
  } else {
    // Création d'un nouveau jalon à la volée.
    const valueHt =
      Number(project.dougsQuoteTotalHt ?? project.valueAmount ?? project.budgetAmount ?? 0) || 0;
    const amountHt =
      args.amountHt ?? (args.percent != null && valueHt > 0 ? (valueHt * args.percent) / 100 : 0);
    if (amountHt <= 0)
      throw new Error("amountHt ou percent (avec valueAmount > 0) requis pour créer un jalon.");
    const percent = args.percent ?? (valueHt > 0 ? Math.round((amountHt / valueHt) * 100) : null);
    const inferredType: "acompte" | "intermediaire" | "solde" =
      args.type ??
      (percent != null && percent < 50
        ? "acompte"
        : percent != null && percent >= 50 && percent < 95
          ? "intermediaire"
          : "solde");
    const inferredLabel =
      args.label ??
      (inferredType === "acompte"
        ? `Acompte ${percent ?? ""} %`.trim()
        : inferredType === "solde"
          ? `Solde ${percent ?? "100"} %`.trim()
          : `Intermédiaire ${percent ?? ""} %`.trim());

    milestone = {
      id: randomUUID(),
      type: inferredType,
      label: inferredLabel,
      percent,
      amountHt: Math.round(amountHt * 100) / 100,
      vatRate: 0.2,
      status: "todo",
      dougsInvoiceId: null,
      dougsInvoiceReference: null,
      invoicedAt: null,
      paidAt: null,
    };
    milestones.push(milestone);
    milestoneIndex = milestones.length - 1;
  }

  if (!milestone) throw new Error("Jalon impossible à résoudre.");
  if (milestone.amountHt <= 0) throw new Error("Montant du jalon = 0.");

  const clientData = await buildClientDataFromEntity(
    ctx.userId,
    row.entityName,
    {
      siren: row.entitySiren,
      vatNumber: row.entityVatNumber,
      address: row.entityAddress,
    },
    row.contactEmail,
  );

  const description =
    milestone.percent != null
      ? `${milestone.percent.toLocaleString("fr-FR")} % du projet "${project.name}".`
      : `Facture liée au projet "${project.name}".`;

  const lines = [
    {
      title: milestone.label,
      description,
      unit: "forfait",
      quantity: 1,
      unitAmount: milestone.amountHt,
      vatRate: milestone.vatRate,
      discount: 0,
      discountUnit: "%",
      reference: null,
      amount: milestone.amountHt,
      discountInEuros: 0,
      isPriceWithVat: false,
    },
  ];

  const draft = await createDougsSalesInvoiceDraft(ctx.userId);
  await updateDougsSalesInvoice(ctx.userId, draft.id, {
    ...draft,
    clientData,
    lines,
  });

  // Met à jour le jalon avec le lien Dougs + statut invoiced.
  const updatedMilestones = [...milestones];
  updatedMilestones[milestoneIndex] = {
    ...milestone,
    status: "invoiced",
    dougsInvoiceId: draft.id,
    dougsInvoiceReference: draft.reference,
    invoicedAt: new Date().toISOString(),
  };

  await conn
    .update(projects)
    .set({ billingMilestones: updatedMilestones, updatedAt: new Date() })
    .where(eq(projects.id, args.projectId));

  const url = await getDougsDraftUrl(ctx.userId, draft.id);
  return {
    dougsInvoiceId: draft.id,
    reference: draft.reference,
    milestoneId: milestone.id,
    milestoneLabel: milestone.label,
    url,
  };
}

// ---------- 3. push_coworking_invoice ----------

export const pushCoworkingInvoiceMcpSchema = z.object({
  coworkingInvoiceId: z.string().uuid(),
});

export async function pushCoworkingInvoiceMcp(
  args: z.infer<typeof pushCoworkingInvoiceMcpSchema>,
  ctx: { userId: string },
) {
  const conn = await db();
  const [row] = await conn
    .select({
      invoice: coworkingInvoices,
      contract: coworkingContracts,
      contactFirstName: contactsTable.firstName,
      contactLastName: contactsTable.lastName,
      contactEmail: contactsTable.email,
      contactAddress: contactsTable.address,
      billToEntityName: entitiesTable.name,
      billToEntitySiren: entitiesTable.siren,
      billToEntityVatNumber: entitiesTable.vatNumber,
      billToEntityAddress: entitiesTable.address,
    })
    .from(coworkingInvoices)
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, coworkingInvoices.contractId))
    .leftJoin(contactsTable, eq(contactsTable.id, coworkingContracts.contactId))
    .leftJoin(entitiesTable, eq(entitiesTable.id, coworkingContracts.billToEntityId))
    .where(eq(coworkingInvoices.id, args.coworkingInvoiceId))
    .limit(1);

  if (!row || !row.contract) throw new Error("Facture coworking introuvable.");
  const { invoice, contract } = row;
  const isBtoB = Boolean(contract.billToEntityId);
  const searchName = isBtoB
    ? (row.billToEntityName ?? "")
    : `${row.contactFirstName ?? ""} ${row.contactLastName ?? ""}`.trim();
  if (!searchName) throw new Error("Nom client introuvable (entité ou contact manquant).");

  let clientData: Record<string, unknown>;
  if (isBtoB) {
    clientData = await buildClientDataFromEntity(
      ctx.userId,
      searchName,
      {
        siren: row.billToEntitySiren,
        vatNumber: row.billToEntityVatNumber,
        address: row.billToEntityAddress,
      },
      row.contactEmail,
    );
  } else {
    // B2C : minimal client data depuis le contact (pas de recherche
    // Dougs B2C nécessaire pour MVP).
    const addr = row.contactAddress as {
      street?: string;
      postalCode?: string;
      city?: string;
      country?: string;
    } | null;
    clientData = {
      isBToB: false,
      legalName: null,
      siren: null,
      siret: null,
      vatNumber: null,
      firstName: row.contactFirstName,
      lastName: row.contactLastName,
      address: {
        street: addr?.street ?? "",
        zipCode: addr?.postalCode ?? "",
        city: addr?.city ?? "",
        country: addr?.country ?? "France",
      },
      deliveryAddress: { street: "", zipCode: "", city: "", country: "" },
      others: [],
      email: row.contactEmail ?? null,
      phone: null,
      clientId: null,
    };
  }

  const start = new Date(invoice.periodStart);
  const end = new Date(invoice.periodEnd);
  const months = Math.max(
    1,
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1,
  );
  const desks = contract.desks;
  const monthlyHt = Number(contract.unitPriceHt);
  const vatRate = Number(invoice.vatRate);
  const lineAmount = desks * monthlyHt * months;

  const lines = [
    {
      title: "Prestation d'hébergement",
      description: `${desks} poste${desks > 1 ? "s" : ""} × ${monthlyHt.toLocaleString("fr-FR")} €/mois × ${months} mois (${invoice.periodStart} → ${invoice.periodEnd})`,
      unit: "mois",
      quantity: months,
      unitAmount: desks * monthlyHt,
      vatRate,
      discount: 0,
      discountUnit: "%",
      reference: null,
      amount: lineAmount,
      discountInEuros: 0,
      isPriceWithVat: false,
    },
  ];

  const draft = await createDougsSalesInvoiceDraft(ctx.userId);
  await updateDougsSalesInvoice(ctx.userId, draft.id, { ...draft, clientData, lines });

  await conn
    .update(coworkingInvoices)
    .set({ dougsInvoiceId: draft.id, updatedAt: new Date() })
    .where(eq(coworkingInvoices.id, args.coworkingInvoiceId));

  const url = await getDougsDraftUrl(ctx.userId, draft.id);
  return { dougsInvoiceId: draft.id, reference: draft.reference, url };
}
