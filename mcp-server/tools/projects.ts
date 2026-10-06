import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { entities } from "../../db/schema/entities";
import { invoices as invoicesTable } from "../../db/schema/invoices";
import { projects } from "../../db/schema/projects";
import { tasks } from "../../db/schema/tasks";
import { timeEntries } from "../../db/schema/time-entries";
import { users } from "../../db/schema/users";
import { matchProject } from "../../lib/crm/candidates";
import { isCertainMatch } from "../../lib/crm/pick";
import type { UserContext } from "../context";
import { db } from "../db";
import { DEFAULT_LIMIT } from "./shared";

export const listProjectsSchema = z.object({
  status: z
    .enum([
      "not_started",
      "to_follow_up",
      "awaiting_response",
      "won",
      "lost",
      "planning",
      "active",
      "on_hold",
      "completed",
      "archived",
    ])
    .optional(),
  kind: z.enum(["client", "product", "transverse"]).optional(),
  search: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export async function listProjects(args: z.infer<typeof listProjectsSchema>) {
  const conn = db();
  const conds = [];
  if (args.status) conds.push(eq(projects.status, args.status));
  if (args.kind) conds.push(eq(projects.kind, args.kind));
  if (args.search) {
    const like = `%${args.search}%`;
    const o = or(ilike(projects.name, like), ilike(entities.name, like));
    if (o) conds.push(o);
  }
  const rows = await conn
    .select({
      id: projects.id,
      name: projects.name,
      kind: projects.kind,
      status: projects.status,
      entityName: entities.name,
      ownerId: projects.ownerId,
      startDate: projects.startDate,
      endDate: projects.endDate,
      valueAmount: projects.valueAmount,
      budgetAmount: projects.budgetAmount,
      probability: projects.probability,
      followUpDate: projects.followUpDate,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(projects.updatedAt))
    .limit(args.limit ?? DEFAULT_LIMIT);

  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return rows;

  // Agrégat facturation par projet en une seule requête.
  //  - dougs_quote_total_ht : max sur les rows kind='quote' (1 par projet).
  //  - invoiced/paid/outstanding : sur milestone + one_off uniquement.
  //  - next_due_date : min due_date des lignes status='sent'.
  //  - overdue_count : lignes status='sent' avec due_date passée.
  const billingAggs = await conn
    .select({
      projectId: invoicesTable.projectId,
      dougsQuoteTotalHt: sql<
        string | null
      >`max(case when ${invoicesTable.kind} = 'quote' then ${invoicesTable.dougsTotalHt} end)`,
      invoicedHt: sql<string>`coalesce(sum(case when ${invoicesTable.kind} in ('milestone','one_off') and ${invoicesTable.status} in ('sent','paid') then ${invoicesTable.amountHt} else 0 end), 0)`,
      paidHt: sql<string>`coalesce(sum(case when ${invoicesTable.kind} in ('milestone','one_off') and ${invoicesTable.status} = 'paid' then ${invoicesTable.amountHt} else 0 end), 0)`,
      outstandingHt: sql<string>`coalesce(sum(case when ${invoicesTable.kind} in ('milestone','one_off') and ${invoicesTable.status} = 'sent' then ${invoicesTable.amountHt} else 0 end), 0)`,
      creditsHt: sql<string>`coalesce(sum(case when ${invoicesTable.kind} = 'credit_note' then ${invoicesTable.amountHt} else 0 end), 0)`,
      nextDueDate: sql<
        string | null
      >`min(case when ${invoicesTable.kind} in ('milestone','one_off') and ${invoicesTable.status} = 'sent' then ${invoicesTable.dueDate} end)`,
      overdueCount: sql<number>`coalesce(sum(case when ${invoicesTable.kind} in ('milestone','one_off') and ${invoicesTable.status} = 'sent' and ${invoicesTable.dueDate} < current_date then 1 else 0 end), 0)::int`,
    })
    .from(invoicesTable)
    .where(inArray(invoicesTable.projectId, ids))
    .groupBy(invoicesTable.projectId);

  const byId = new Map(billingAggs.map((b) => [b.projectId as string, b]));
  return rows.map((r) => {
    const agg = byId.get(r.id);
    const dougsQuoteTotalHt = agg?.dougsQuoteTotalHt != null ? Number(agg.dougsQuoteTotalHt) : null;
    const manualValueHt =
      r.valueAmount != null
        ? Number(r.valueAmount)
        : r.budgetAmount != null
          ? Number(r.budgetAmount)
          : null;
    const totalHt = dougsQuoteTotalHt ?? manualValueHt ?? 0;
    const invoicedHt = agg ? Number(agg.invoicedHt) : 0;
    const paidHt = agg ? Number(agg.paidHt) : 0;
    const outstandingHt = agg ? Number(agg.outstandingHt) : 0;
    return {
      ...r,
      billing: {
        totalHt,
        totalSource:
          dougsQuoteTotalHt != null
            ? ("dougs_quote" as const)
            : r.valueAmount != null
              ? ("project_value" as const)
              : r.budgetAmount != null
                ? ("project_budget" as const)
                : ("none" as const),
        invoicedHt,
        paidHt,
        outstandingHt,
        remainingToInvoiceHt: Math.max(0, totalHt - invoicedHt),
        creditsHt: agg ? Number(agg.creditsHt) : 0,
        nextDueDate: agg?.nextDueDate ?? null,
        overdueCount: agg?.overdueCount ?? 0,
      },
    };
  });
}

/**
 * Kinds de facture rattachables à un projet (exclut coworking).
 * Coworking a son propre lien via coworking_contract_id.
 */
const PROJECT_INVOICE_KINDS = ["quote", "milestone", "one_off", "credit_note"] as const;

/**
 * Charge tout l'historique de facturation d'un projet + rollup.
 *
 * Source de vérité pour `totalHt` : le total HT du devis Dougs si un
 * devis est lié, sinon `project.valueAmount`, sinon `project.budgetAmount`.
 * Miroite la logique visible sur la page projet (BillingSummary + FactsBand).
 *
 * Statuts contribuant aux rollups (milestones + one_off) :
 *   - invoicedHt  : status ∈ {sent, paid}   (facturé émis)
 *   - paidHt      : status = paid           (encaissé)
 *   - outstandingHt : status = sent         (facturé, non encore payé)
 *   - remainingToInvoiceHt : max(0, totalHt - invoicedHt) (reste à émettre)
 *   - creditsHt   : somme des credit_note (avoirs)
 */
async function getProjectBillingDetails(
  projectId: string,
  projectValueAmount: string | null,
  projectBudgetAmount: string | null,
) {
  const conn = db();
  const rows = await conn
    .select()
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.projectId, projectId),
        inArray(invoicesTable.kind, [...PROJECT_INVOICE_KINDS]),
      ),
    )
    .orderBy(asc(invoicesTable.createdAt));

  const quote = rows.find((r) => r.kind === "quote") ?? null;
  const milestones = rows.filter((r) => r.kind === "milestone");
  const oneOffs = rows.filter((r) => r.kind === "one_off");
  const creditNotes = rows.filter((r) => r.kind === "credit_note");

  const dougsQuoteTotalHt = quote?.dougsTotalHt != null ? Number(quote.dougsTotalHt) : null;
  const manualValueHt =
    projectValueAmount != null
      ? Number(projectValueAmount)
      : projectBudgetAmount != null
        ? Number(projectBudgetAmount)
        : null;
  const totalHt = dougsQuoteTotalHt ?? manualValueHt ?? 0;
  const totalSource: "dougs_quote" | "project_value" | "project_budget" | "none" =
    dougsQuoteTotalHt != null
      ? "dougs_quote"
      : projectValueAmount != null
        ? "project_value"
        : projectBudgetAmount != null
          ? "project_budget"
          : "none";

  const billable = [...milestones, ...oneOffs];
  const sumIf = (pred: (r: (typeof billable)[number]) => boolean) =>
    billable.filter(pred).reduce((s, r) => s + Number(r.amountHt || 0), 0);
  const invoicedHt = sumIf((r) => r.status === "sent" || r.status === "paid");
  const paidHt = sumIf((r) => r.status === "paid");
  const outstandingHt = sumIf((r) => r.status === "sent");
  const creditsHt = creditNotes.reduce((s, r) => s + Number(r.amountHt || 0), 0);
  const remainingToInvoiceHt = Math.max(0, totalHt - invoicedHt);

  const today = new Date().toISOString().slice(0, 10);
  const sentWithDue = billable.filter((r) => r.status === "sent" && r.dueDate);
  const nextDueDate = sentWithDue.map((r) => r.dueDate as string).sort()[0] ?? null;
  const overdueCount = sentWithDue.filter((r) => (r.dueDate as string) < today).length;

  const shapeCommon = (r: (typeof rows)[number]) => ({
    id: r.id,
    label: r.label,
    reference: r.reference,
    amountHt: Number(r.amountHt || 0),
    vatRate: Number(r.vatRate || 0),
    status: r.status,
    invoicedAt: r.invoicedAt,
    paidAt: r.paidAt,
    dueDate: r.dueDate,
    reminderCount: r.reminderCount,
    lastRemindedAt: r.lastRemindedAt,
    assignedTo: r.assignedTo,
    dougsInvoiceId: r.dougsInvoiceId,
    dougsReference: r.dougsReference,
    dougsStatus: r.dougsStatus,
    dougsTotalHt: r.dougsTotalHt != null ? Number(r.dougsTotalHt) : null,
    dougsPaidAt: r.dougsPaidAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });

  return {
    quote: quote
      ? {
          ...shapeCommon(quote),
          dougsQuoteId: quote.dougsQuoteId,
          dougsTotalTtc: quote.dougsTotalTtc != null ? Number(quote.dougsTotalTtc) : null,
          dougsSyncedAt: quote.dougsSyncedAt,
        }
      : null,
    milestones: milestones.map((r) => ({
      ...shapeCommon(r),
      milestoneType: r.milestoneType,
      milestonePercent: r.milestonePercent,
    })),
    oneOffs: oneOffs.map(shapeCommon),
    creditNotes: creditNotes.map((r) => ({
      ...shapeCommon(r),
      cancelsInvoiceId: r.cancelsInvoiceId,
      cancelsDougsInvoiceId: r.cancelsDougsInvoiceId,
    })),
    rollup: {
      totalHt,
      totalSource,
      manualValueHt,
      dougsQuoteTotalHt,
      invoicedHt,
      paidHt,
      outstandingHt,
      remainingToInvoiceHt,
      creditsHt,
      netInvoicedHt: invoicedHt - creditsHt,
      nextDueDate,
      overdueCount,
      pctInvoiced: totalHt > 0 ? Math.round((invoicedHt / totalHt) * 100) : 0,
      pctPaid: totalHt > 0 ? Math.round((paidHt / totalHt) * 100) : 0,
      counts: {
        milestones: milestones.length,
        milestonesDraft: milestones.filter((r) => r.status === "draft").length,
        milestonesSent: milestones.filter((r) => r.status === "sent").length,
        milestonesPaid: milestones.filter((r) => r.status === "paid").length,
        oneOffs: oneOffs.length,
        creditNotes: creditNotes.length,
      },
    },
  };
}

export const getProjectSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().optional(),
});

export async function getProject(args: z.infer<typeof getProjectSchema>) {
  if (!args.id && !args.name) {
    throw new Error("Fournis `id` ou `name`.");
  }
  const conn = db();
  const where = args.id ? eq(projects.id, args.id) : ilike(projects.name, `%${args.name}%`);
  const [proj] = await conn
    .select()
    .from(projects)
    .where(where)
    .orderBy(desc(projects.updatedAt))
    .limit(1);
  if (!proj) return null;

  const [entity, ownerRow, taskRows, stats, billing] = await Promise.all([
    proj.entityId
      ? conn
          .select()
          .from(entities)
          .where(eq(entities.id, proj.entityId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    proj.ownerId
      ? conn
          .select()
          .from(users)
          .where(eq(users.id, proj.ownerId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    conn
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        dueDate: tasks.dueDate,
      })
      .from(tasks)
      .where(eq(tasks.projectId, proj.id))
      .orderBy(asc(tasks.dueDate)),
    conn
      .select({
        plannedMinutes: sql<number>`coalesce(sum(case when ${timeEntries.kind} = 'planned' then extract(epoch from (${timeEntries.endAt} - ${timeEntries.startAt})) / 60 else 0 end), 0)::int`,
        actualMinutes: sql<number>`coalesce(sum(case when ${timeEntries.kind} = 'actual' then extract(epoch from (${timeEntries.endAt} - ${timeEntries.startAt})) / 60 else 0 end), 0)::int`,
      })
      .from(timeEntries)
      .where(eq(timeEntries.projectId, proj.id))
      .then((r) => r[0] ?? { plannedMinutes: 0, actualMinutes: 0 }),
    getProjectBillingDetails(proj.id, proj.valueAmount, proj.budgetAmount),
  ]);

  return {
    project: proj,
    entity,
    owner: ownerRow ? { id: ownerRow.id, fullName: ownerRow.fullName } : null,
    tasks: {
      total: taskRows.length,
      open: taskRows.filter((t) => t.status !== "done" && t.status !== "cancelled").length,
      list: taskRows.slice(0, 20),
    },
    time: stats,
    billing,
  };
}

// ---------- PROJETS ----------
// Création/édition de projets (= opportunités en phase commerciale).
// IMPORTANT : `confirmed: true` est OBLIGATOIRE pour create_project,
// l'agent doit explicitement demander l'avis du user avant — cf.
// description côté registry MCP.

const projectKindEnum = z.enum(["client", "product", "transverse"]);
const projectStatusEnum = z.enum([
  "not_started",
  "to_follow_up",
  "awaiting_response",
  "won",
  "lost",
  "planning",
  "active",
  "on_hold",
  "completed",
  "archived",
]);
const projectBillingTypeEnum = z.enum(["none", "fixed", "hourly"]);

export const createProjectSchema = z.object({
  /**
   * Garde-fou : l'agent DOIT poser la question à l'utilisateur avant
   * d'appeler ce tool et obtenir une confirmation explicite. Mettre
   * `true` uniquement après confirmation. Si false ou absent, le tool
   * échoue.
   */
  confirmed: z.literal(true, {
    errorMap: () => ({
      message:
        "Demande d'abord à l'utilisateur de confirmer la création du projet/opportunité avec tous les champs, puis renseigne confirmed=true.",
    }),
  }),
  name: z.string().trim().min(1).max(200),
  kind: projectKindEnum.default("client"),
  status: projectStatusEnum.default("not_started"),
  entityId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  billingType: projectBillingTypeEnum.default("none"),
  budgetAmount: z.number().nonnegative().nullable().optional(),
  hourlyRate: z.number().nonnegative().nullable().optional(),
  valueAmount: z.number().nonnegative().nullable().optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  source: z.string().max(200).nullable().optional(),
  firstContactDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  expectedCloseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export async function createProject(args: z.infer<typeof createProjectSchema>, ctx: UserContext) {
  const conn = db();
  // Scopé sur l'entité quand elle est fournie : deux projets d'un même
  // client partagent leur préfixe, sans scope on risquerait de confondre
  // deux affaires distinctes.
  const existing = await matchProject(
    conn,
    args.name,
    args.entityId ? { entityId: args.entityId } : undefined,
  );
  if (existing && isCertainMatch(existing)) {
    const [found] = await conn
      .select({
        id: projects.id,
        name: projects.name,
        kind: projects.kind,
        status: projects.status,
      })
      .from(projects)
      .where(eq(projects.id, existing.id))
      .limit(1);
    return { ...found, alreadyExisted: true as const };
  }
  const [row] = await conn
    .insert(projects)
    .values({
      name: args.name,
      kind: args.kind,
      status: args.status,
      entityId: args.entityId ?? null,
      contactId: args.contactId ?? null,
      description: args.description ?? null,
      startDate: args.startDate ?? null,
      endDate: args.endDate ?? null,
      billingType: args.billingType,
      budgetAmount: args.budgetAmount != null ? args.budgetAmount.toString() : null,
      hourlyRate: args.hourlyRate != null ? args.hourlyRate.toString() : null,
      valueAmount: args.valueAmount != null ? args.valueAmount.toString() : null,
      probability: args.probability ?? null,
      source: args.source ?? null,
      firstContactDate: args.firstContactDate ?? null,
      followUpDate: args.followUpDate ?? null,
      expectedCloseDate: args.expectedCloseDate ?? null,
      ownerId: ctx.userId,
      createdBy: ctx.userId,
    })
    .returning({
      id: projects.id,
      name: projects.name,
      kind: projects.kind,
      status: projects.status,
    });
  return row ? { ...row, alreadyExisted: false as const } : null;
}

export const updateProjectSchema = z.object({
  id: z.string().uuid(),
  /** Confirmation requise pour les changements de status structurants
   * (won/lost/archived) — facultatif pour les autres mises à jour. */
  confirmed: z.boolean().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  kind: projectKindEnum.optional(),
  status: projectStatusEnum.optional(),
  entityId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  billingType: projectBillingTypeEnum.optional(),
  budgetAmount: z.number().nonnegative().nullable().optional(),
  hourlyRate: z.number().nonnegative().nullable().optional(),
  valueAmount: z.number().nonnegative().nullable().optional(),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  source: z.string().max(200).nullable().optional(),
  firstContactDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  lastContactDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  expectedCloseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export async function updateProject(args: z.infer<typeof updateProjectSchema>) {
  // Garde-fou structurant : demander confirmation pour les transitions
  // commerciales finales (won/lost) et archived.
  const sensitiveStatus =
    args.status === "won" || args.status === "lost" || args.status === "archived";
  if (sensitiveStatus && args.confirmed !== true) {
    throw new Error(
      `Transition de statut vers "${args.status}" nécessite une confirmation explicite (confirmed=true). Demande l'avis de l'utilisateur d'abord.`,
    );
  }

  const conn = db();
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (args.name !== undefined) update.name = args.name;
  if (args.kind !== undefined) update.kind = args.kind;
  if (args.status !== undefined) update.status = args.status;
  if (args.entityId !== undefined) update.entityId = args.entityId;
  if (args.contactId !== undefined) update.contactId = args.contactId;
  if (args.description !== undefined) update.description = args.description;
  if (args.startDate !== undefined) update.startDate = args.startDate;
  if (args.endDate !== undefined) update.endDate = args.endDate;
  if (args.billingType !== undefined) update.billingType = args.billingType;
  if (args.budgetAmount !== undefined)
    update.budgetAmount = args.budgetAmount != null ? args.budgetAmount.toString() : null;
  if (args.hourlyRate !== undefined)
    update.hourlyRate = args.hourlyRate != null ? args.hourlyRate.toString() : null;
  if (args.valueAmount !== undefined)
    update.valueAmount = args.valueAmount != null ? args.valueAmount.toString() : null;
  if (args.probability !== undefined) update.probability = args.probability;
  if (args.source !== undefined) update.source = args.source;
  if (args.firstContactDate !== undefined) update.firstContactDate = args.firstContactDate;
  if (args.lastContactDate !== undefined) update.lastContactDate = args.lastContactDate;
  if (args.followUpDate !== undefined) update.followUpDate = args.followUpDate;
  if (args.expectedCloseDate !== undefined) update.expectedCloseDate = args.expectedCloseDate;

  await conn.update(projects).set(update).where(eq(projects.id, args.id));
  return { id: args.id };
}

// ---------- PROJECT INVOICES (devis, jalons, factures libres, avoirs) ----------

const projectInvoiceKindEnum = z.enum(["quote", "milestone", "one_off", "credit_note"]);
const projectInvoiceStatusEnum = z.enum(["draft", "sent", "accepted", "refused", "paid"]);

export const listProjectInvoicesSchema = z.object({
  projectId: z.string().uuid().optional(),
  /** Recherche fuzzy sur le nom du projet si `projectId` non fourni. */
  projectName: z.string().optional(),
  kind: projectInvoiceKindEnum.optional(),
  status: projectInvoiceStatusEnum.optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export async function listProjectInvoices(args: z.infer<typeof listProjectInvoicesSchema>) {
  if (!args.projectId && !args.projectName) {
    throw new Error("Fournis `projectId` ou `projectName`.");
  }
  const conn = db();

  let projectId = args.projectId;
  if (!projectId && args.projectName) {
    const [p] = await conn
      .select({ id: projects.id })
      .from(projects)
      .where(ilike(projects.name, `%${args.projectName}%`))
      .orderBy(desc(projects.updatedAt))
      .limit(1);
    if (!p) return { projectId: null, invoices: [] };
    projectId = p.id;
  }

  const conds = [
    eq(invoicesTable.projectId, projectId as string),
    inArray(invoicesTable.kind, [...PROJECT_INVOICE_KINDS]),
  ];
  if (args.kind) conds.push(eq(invoicesTable.kind, args.kind));
  if (args.status) conds.push(eq(invoicesTable.status, args.status));

  const rows = await conn
    .select({
      id: invoicesTable.id,
      kind: invoicesTable.kind,
      label: invoicesTable.label,
      reference: invoicesTable.reference,
      status: invoicesTable.status,
      amountHt: invoicesTable.amountHt,
      vatRate: invoicesTable.vatRate,
      invoicedAt: invoicesTable.invoicedAt,
      paidAt: invoicesTable.paidAt,
      dueDate: invoicesTable.dueDate,
      reminderCount: invoicesTable.reminderCount,
      lastRemindedAt: invoicesTable.lastRemindedAt,
      assignedTo: invoicesTable.assignedTo,
      milestoneType: invoicesTable.milestoneType,
      milestonePercent: invoicesTable.milestonePercent,
      cancelsInvoiceId: invoicesTable.cancelsInvoiceId,
      cancelsDougsInvoiceId: invoicesTable.cancelsDougsInvoiceId,
      dougsInvoiceId: invoicesTable.dougsInvoiceId,
      dougsQuoteId: invoicesTable.dougsQuoteId,
      dougsReference: invoicesTable.dougsReference,
      dougsStatus: invoicesTable.dougsStatus,
      dougsTotalHt: invoicesTable.dougsTotalHt,
      dougsTotalTtc: invoicesTable.dougsTotalTtc,
      dougsIssuedAt: invoicesTable.dougsIssuedAt,
      dougsPaidAt: invoicesTable.dougsPaidAt,
      dougsSyncedAt: invoicesTable.dougsSyncedAt,
      createdAt: invoicesTable.createdAt,
      updatedAt: invoicesTable.updatedAt,
    })
    .from(invoicesTable)
    .where(and(...conds))
    .orderBy(asc(invoicesTable.createdAt))
    .limit(args.limit ?? 200);

  return {
    projectId,
    invoices: rows.map((r) => ({
      ...r,
      amountHt: r.amountHt != null ? Number(r.amountHt) : 0,
      vatRate: r.vatRate != null ? Number(r.vatRate) : 0,
      dougsTotalHt: r.dougsTotalHt != null ? Number(r.dougsTotalHt) : null,
      dougsTotalTtc: r.dougsTotalTtc != null ? Number(r.dougsTotalTtc) : null,
    })),
  };
}
