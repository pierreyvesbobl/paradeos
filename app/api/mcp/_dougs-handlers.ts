import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { contacts as contactsTable } from "../../../db/schema/contacts";
import { coworkingContracts } from "../../../db/schema/coworking";
import { entities as entitiesTable } from "../../../db/schema/entities";
import { invoices } from "../../../db/schema/invoices";
import { projects } from "../../../db/schema/projects";
import { db } from "../../../lib/db/server";
import {
  createDougsQuoteDraft,
  createDougsSalesInvoiceDraft,
  getDougsDraftUrl,
  getDougsQuoteUrl,
  searchDougsClients,
  updateDougsQuote,
  updateDougsSalesInvoice,
} from "../../../lib/dougs/client";

/**
 * Outils MCP qui orchestrent : push Dougs + écriture dans invoices.
 * Atomicité : si Dougs throw, on n'écrit rien en DB.
 *
 * Pas de revalidatePath — l'agent ne déclenche pas de cache invalidation UI.
 */

// ---------- Helper : clientData depuis une entité ----------

async function buildClientDataFromEntity(
  userId: string,
  entityName: string,
  fallback: {
    siren: string | null;
    vatNumber: string | null;
    address: unknown;
  },
  contactEmail: string | null,
): Promise<Record<string, unknown>> {
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
  const localAddr = fallback.address as {
    street?: string;
    postalCode?: string;
    city?: string;
    country?: string;
  } | null;
  return {
    isBToB: true,
    legalName: entityName,
    siren: fallback.siren ?? null,
    siret: null,
    vatNumber: fallback.vatNumber ?? null,
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

  const total = lines.reduce((sum, l) => sum + l.amount, 0);

  // Upsert quote invoice (1 par projet).
  const [existingQuote] = await conn
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.projectId, args.projectId), eq(invoices.kind, "quote")))
    .limit(1);

  const quoteValues = {
    label: `Devis ${project.name}`,
    amountHt: total.toFixed(2),
    vatRate: "0.2",
    status: "sent" as const,
    dougsQuoteId: updated.id,
    dougsReference: updated.reference,
    dougsStatus: updated.status ?? "DRAFT",
    invoicedAt: new Date(),
    dougsSyncedAt: new Date(),
    updatedAt: new Date(),
  };
  if (existingQuote) {
    await conn.update(invoices).set(quoteValues).where(eq(invoices.id, existingQuote.id));
  } else {
    await conn.insert(invoices).values({
      kind: "quote",
      projectId: args.projectId,
      createdBy: ctx.userId,
      ...quoteValues,
    });
  }

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
  type: z.enum(["acompte", "intermediaire", "solde"]).optional(),
  percent: z.number().min(0).max(150).optional(),
  amountHt: z.number().positive().optional(),
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

  // Trouver le total Dougs depuis le devis lié, pour calcul %.
  const [quoteRow] = await conn
    .select({ dougsTotalHt: invoices.dougsTotalHt })
    .from(invoices)
    .where(and(eq(invoices.projectId, args.projectId), eq(invoices.kind, "quote")))
    .limit(1);

  // Charger l'invoice (jalon) existant si milestoneId fourni.
  let milestone: typeof invoices.$inferSelect | null = null;
  if (args.milestoneId) {
    const [m] = await conn
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, args.milestoneId), eq(invoices.kind, "milestone")))
      .limit(1);
    if (!m) throw new Error("Jalon introuvable.");
    milestone = m;
  }

  let amountHt: number;
  let label: string;
  let mType: "acompte" | "intermediaire" | "solde";
  let percent: number | null;

  if (milestone) {
    amountHt = Number(milestone.amountHt);
    label = milestone.label;
    mType = (milestone.milestoneType as "acompte" | "intermediaire" | "solde") ?? "intermediaire";
    percent = milestone.milestonePercent;
  } else {
    const valueHt =
      Number(quoteRow?.dougsTotalHt ?? project.valueAmount ?? project.budgetAmount ?? 0) || 0;
    amountHt =
      args.amountHt ?? (args.percent != null && valueHt > 0 ? (valueHt * args.percent) / 100 : 0);
    if (amountHt <= 0) {
      throw new Error("amountHt ou percent (avec valueAmount > 0) requis pour créer un jalon.");
    }
    percent = args.percent ?? (valueHt > 0 ? Math.round((amountHt / valueHt) * 100) : null);
    mType =
      args.type ??
      (percent != null && percent < 50
        ? "acompte"
        : percent != null && percent >= 50 && percent < 95
          ? "intermediaire"
          : "solde");
    label =
      args.label ??
      (mType === "acompte"
        ? `Acompte ${percent ?? ""} %`.trim()
        : mType === "solde"
          ? `Solde ${percent ?? "100"} %`.trim()
          : `Intermédiaire ${percent ?? ""} %`.trim());
  }

  if (amountHt <= 0) throw new Error("Montant du jalon = 0.");

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
    percent != null
      ? `${percent.toLocaleString("fr-FR")} % du projet "${project.name}".`
      : `Facture liée au projet "${project.name}".`;

  const lines = [
    {
      title: label,
      description,
      unit: "forfait",
      quantity: 1,
      unitAmount: amountHt,
      vatRate: 0.2,
      discount: 0,
      discountUnit: "%",
      reference: null,
      amount: amountHt,
      discountInEuros: 0,
      isPriceWithVat: false,
    },
  ];

  const draft = await createDougsSalesInvoiceDraft(ctx.userId);
  await updateDougsSalesInvoice(ctx.userId, draft.id, { ...draft, clientData, lines });

  let milestoneInvoiceId: string;
  if (milestone) {
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
      .where(eq(invoices.id, milestone.id));
    milestoneInvoiceId = milestone.id;
  } else {
    const [inserted] = await conn
      .insert(invoices)
      .values({
        kind: "milestone",
        projectId: args.projectId,
        label,
        amountHt: amountHt.toFixed(2),
        vatRate: "0.2",
        status: "sent",
        milestoneType: mType,
        milestonePercent: percent,
        invoicedAt: new Date(),
        dougsInvoiceId: draft.id,
        dougsReference: draft.reference,
        dougsStatus: "DRAFT",
        dougsSyncedAt: new Date(),
        createdBy: ctx.userId,
      })
      .returning({ id: invoices.id });
    if (!inserted) throw new Error("Insertion jalon échouée.");
    milestoneInvoiceId = inserted.id;
  }

  const url = await getDougsDraftUrl(ctx.userId, draft.id);
  return {
    dougsInvoiceId: draft.id,
    reference: draft.reference,
    milestoneId: milestoneInvoiceId,
    milestoneLabel: label,
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
      invoice: invoices,
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
    .from(invoices)
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
    .leftJoin(contactsTable, eq(contactsTable.id, coworkingContracts.contactId))
    .leftJoin(entitiesTable, eq(entitiesTable.id, coworkingContracts.billToEntityId))
    .where(and(eq(invoices.id, args.coworkingInvoiceId), eq(invoices.kind, "coworking")))
    .limit(1);

  if (!row || !row.contract) throw new Error("Facture coworking introuvable.");
  const { invoice, contract } = row;
  if (!invoice.periodStart || !invoice.periodEnd) {
    throw new Error("Période manquante sur la facture.");
  }
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
  const desks = invoice.desks ?? contract.desks;
  const monthlyHt = Number(invoice.unitPriceHt ?? contract.unitPriceHt);
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
    .where(eq(invoices.id, args.coworkingInvoiceId));

  const url = await getDougsDraftUrl(ctx.userId, draft.id);
  return { dougsInvoiceId: draft.id, reference: draft.reference, url };
}
