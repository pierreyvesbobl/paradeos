/**
 * Cron quotidien : tire le statut + montants finaux des invoices Dougs
 * liées et met à jour le snapshot Paradeos sur la table `invoices`.
 *
 * Auth : `Authorization: Bearer <CRON_SECRET>` (Vercel le pose auto).
 * Limitations Vercel Hobby : 1 exécution/jour max (cf. vercel.json).
 */
import { dougsSessions } from "@/db/schema/dougs";
import { invoices } from "@/db/schema/invoices";
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
import { and, eq, isNotNull, ne } from "drizzle-orm";
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
  invoicesChecked: number;
  invoicesUpdated: number;
  errors: string[];
};

async function syncForUser(userId: string, stats: Stats): Promise<void> {
  const conn = await db();

  // 1) Devis (kind='quote', tant que pas REFUSED).
  const quotes = await conn
    .select({
      id: invoices.id,
      dougsQuoteId: invoices.dougsQuoteId,
      dougsStatus: invoices.dougsStatus,
    })
    .from(invoices)
    .where(and(eq(invoices.kind, "quote"), isNotNull(invoices.dougsQuoteId)));

  for (const q of quotes) {
    if (!q.dougsQuoteId) continue;
    if (q.dougsStatus === "REFUSED") continue;
    stats.quotesChecked++;
    try {
      const quote = await getDougsQuote(userId, q.dougsQuoteId);
      await conn
        .update(invoices)
        .set({
          dougsReference: quote.reference ?? null,
          dougsStatus: pickDougsStatus(quote),
          dougsTotalHt: toNumeric(pickDougsHt(quote)),
          dougsTotalVat: toNumeric(pickDougsVat(quote)),
          dougsTotalTtc: toNumeric(pickDougsTtc(quote)),
          dougsIssuedAt: toDate(pickDougsIssuedAt(quote)),
          dougsSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, q.id));
      stats.quotesUpdated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      stats.errors.push(`quote ${q.id}: ${msg}`);
      if (err instanceof DougsAuthError) return;
    }
    await sleep(150);
  }

  // 2) Factures (kind ≠ quote, status ≠ paid, dougs_invoice_id set).
  const inv = await conn
    .select({
      id: invoices.id,
      dougsInvoiceId: invoices.dougsInvoiceId,
      status: invoices.status,
    })
    .from(invoices)
    .where(and(isNotNull(invoices.dougsInvoiceId), ne(invoices.status, "paid")));

  for (const r of inv) {
    if (!r.dougsInvoiceId) continue;
    stats.invoicesChecked++;
    try {
      const i = await getDougsSalesInvoice(userId, r.dougsInvoiceId);
      const paidAt = pickDougsPaidAt(i);
      await conn
        .update(invoices)
        .set({
          dougsReference: i.reference ?? null,
          dougsStatus: pickDougsStatus(i),
          dougsTotalHt: toNumeric(pickDougsHt(i)),
          dougsTotalVat: toNumeric(pickDougsVat(i)),
          dougsTotalTtc: toNumeric(pickDougsTtc(i)),
          dougsIssuedAt: toDate(pickDougsIssuedAt(i)),
          dougsPaidAt: toDate(paidAt),
          dougsSyncedAt: new Date(),
          status: paidAt ? "paid" : r.status,
          paidAt: toDate(paidAt) ?? null,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, r.id));
      stats.invoicesUpdated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      stats.errors.push(`invoice ${r.id}: ${msg}`);
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
    invoicesChecked: 0,
    invoicesUpdated: 0,
    errors: [],
  };

  try {
    const conn = await db();
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
