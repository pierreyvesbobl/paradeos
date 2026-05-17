/**
 * Cron quotidien : tire le statut + montants finaux des ressources
 * Dougs liées (devis projet, jalons facturés, factures coworking) et
 * met à jour le snapshot Paradeos. Évite à l'utilisateur de cliquer
 * "Rafraîchir" sur chaque entrée.
 *
 * Auth : `Authorization: Bearer <CRON_SECRET>` (Vercel le pose auto).
 *
 * Limitations Vercel Hobby : 1 exécution/jour max (cf. vercel.json).
 */
import { coworkingInvoices } from "@/db/schema/coworking";
import { dougsSessions } from "@/db/schema/dougs";
import { type BillingMilestone, projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import {
  DougsApiError,
  DougsAuthError,
  getDougsQuote,
  getDougsSalesInvoice,
  pickDougsHt,
  pickDougsIssuedAt,
  pickDougsPaidAt,
  pickDougsStatus,
  pickDougsTtc,
  pickDougsVat,
} from "@/lib/dougs/client";
import { and, eq, isNotNull, ne, or } from "drizzle-orm";
import { NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function toNumeric(n: number | null | undefined): string | null {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : null;
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type Stats = {
  quotesChecked: number;
  quotesUpdated: number;
  milestonesChecked: number;
  milestonesUpdated: number;
  coworkingChecked: number;
  coworkingUpdated: number;
  errors: string[];
};

async function syncForUser(userId: string, stats: Stats): Promise<void> {
  const conn = await db();

  // 1) Devis projet : refresh tant que pas REFUSED (terminal côté Dougs).
  const projectsWithQuote = await conn
    .select({
      id: projects.id,
      dougsQuoteId: projects.dougsQuoteId,
      dougsQuoteStatus: projects.dougsQuoteStatus,
      billingMilestones: projects.billingMilestones,
    })
    .from(projects)
    .where(
      and(
        isNotNull(projects.dougsQuoteId),
        or(eq(projects.dougsQuoteStatus, "REFUSED"), ne(projects.dougsQuoteStatus, "REFUSED")),
      ),
    );

  for (const p of projectsWithQuote) {
    // Refresh devis
    if (p.dougsQuoteId && p.dougsQuoteStatus !== "REFUSED") {
      stats.quotesChecked++;
      try {
        const quote = await getDougsQuote(userId, p.dougsQuoteId);
        await conn
          .update(projects)
          .set({
            dougsQuoteReference: quote.reference ?? null,
            dougsQuoteStatus: pickDougsStatus(quote),
            dougsQuoteTotalHt: toNumeric(pickDougsHt(quote)),
            dougsQuoteTotalVat: toNumeric(pickDougsVat(quote)),
            dougsQuoteTotalTtc: toNumeric(pickDougsTtc(quote)),
            dougsQuoteIssuedAt: toDate(pickDougsIssuedAt(quote)),
            dougsQuoteSyncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(projects.id, p.id));
        stats.quotesUpdated++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        stats.errors.push(`quote ${p.id}: ${msg}`);
        if (err instanceof DougsAuthError) return; // session HS, sortir
      }
      await sleep(150);
    }

    // 2) Jalons facturés (pas encore payés)
    const milestones = (p.billingMilestones ?? []) as BillingMilestone[];
    let milestonesChanged = false;
    const updated: BillingMilestone[] = [];
    for (const m of milestones) {
      if (m.dougsInvoiceId && m.status !== "paid") {
        stats.milestonesChecked++;
        try {
          const inv = await getDougsSalesInvoice(userId, m.dougsInvoiceId);
          milestonesChanged = true;
          stats.milestonesUpdated++;
          const paidAt = pickDougsPaidAt(inv);
          updated.push({
            ...m,
            dougsInvoiceReference: inv.reference ?? m.dougsInvoiceReference,
            dougsStatus: pickDougsStatus(inv),
            dougsTotalHt: pickDougsHt(inv),
            dougsTotalVat: pickDougsVat(inv),
            dougsTotalTtc: pickDougsTtc(inv),
            dougsIssuedAt: pickDougsIssuedAt(inv),
            dougsSyncedAt: new Date().toISOString(),
            paidAt: paidAt ?? m.paidAt,
            status: paidAt ? "paid" : m.status,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown";
          stats.errors.push(`milestone ${m.id}: ${msg}`);
          updated.push(m);
          if (err instanceof DougsAuthError) return;
        }
        await sleep(150);
      } else {
        updated.push(m);
      }
    }
    if (milestonesChanged) {
      await conn
        .update(projects)
        .set({ billingMilestones: updated, updatedAt: new Date() })
        .where(eq(projects.id, p.id));
    }
  }

  // 3) Factures coworking liées et pas payées
  const cwInvoices = await conn
    .select({
      id: coworkingInvoices.id,
      dougsInvoiceId: coworkingInvoices.dougsInvoiceId,
      status: coworkingInvoices.status,
    })
    .from(coworkingInvoices)
    .where(and(isNotNull(coworkingInvoices.dougsInvoiceId), ne(coworkingInvoices.status, "payee")));

  for (const cw of cwInvoices) {
    if (!cw.dougsInvoiceId) continue;
    stats.coworkingChecked++;
    try {
      const inv = await getDougsSalesInvoice(userId, cw.dougsInvoiceId);
      const paidAt = pickDougsPaidAt(inv);
      const localStatus = paidAt && cw.status !== "payee" ? ("payee" as const) : cw.status;
      await conn
        .update(coworkingInvoices)
        .set({
          dougsInvoiceReference: inv.reference ?? null,
          dougsInvoiceStatus: pickDougsStatus(inv),
          dougsInvoiceTotalHt: toNumeric(pickDougsHt(inv)),
          dougsInvoiceTotalVat: toNumeric(pickDougsVat(inv)),
          dougsInvoiceTotalTtc: toNumeric(pickDougsTtc(inv)),
          dougsInvoiceIssuedAt: toDate(pickDougsIssuedAt(inv)),
          dougsInvoicePaidAt: toDate(paidAt),
          dougsInvoiceSyncedAt: new Date(),
          status: localStatus,
          updatedAt: new Date(),
        })
        .where(eq(coworkingInvoices.id, cw.id));
      stats.coworkingUpdated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      stats.errors.push(`coworking ${cw.id}: ${msg}`);
      if (err instanceof DougsAuthError) return;
      if (err instanceof DougsApiError) continue;
    }
    await sleep(150);
  }
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const stats: Stats = {
    quotesChecked: 0,
    quotesUpdated: 0,
    milestonesChecked: 0,
    milestonesUpdated: 0,
    coworkingChecked: 0,
    coworkingUpdated: 0,
    errors: [],
  };

  try {
    const conn = await db();
    // Tous les users avec une session Dougs active. En pratique Parade
    // = 1 user actif sur Dougs, mais on boucle au cas où.
    const sessions = await conn.select({ userId: dougsSessions.userId }).from(dougsSessions);

    for (const s of sessions) {
      await syncForUser(s.userId, stats);
    }

    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    console.error("[cron sync-dougs-status]", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "unknown",
        ...stats,
      },
      { status: 500 },
    );
  }
}
