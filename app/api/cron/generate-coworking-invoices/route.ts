import { coworkingContracts } from "@/db/schema/coworking";
import { generateNextInvoiceForContract } from "@/lib/coworking/generate-invoice";
import { db } from "@/lib/db/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Auto-génération mensuelle des factures coworking. Tourne le 1er de
 * chaque mois (cf. vercel.json) et crée une ligne `a_facturer` pour
 * chaque contrat `en_cours` dont la période suivante est due.
 *
 * Idempotent : si la facture du mois en cours existe déjà (créée à la
 * main via le bouton, ou par un run précédent), le helper la skip car
 * la "next period" calculée serait dans le futur.
 *
 * Auth : `Authorization: Bearer <CRON_SECRET>`. Vercel Cron pose le
 * header automatiquement quand `CRON_SECRET` est défini.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const conn = await db();
  const ongoing = await conn
    .select({ id: coworkingContracts.id, name: coworkingContracts.name })
    .from(coworkingContracts)
    .where(eq(coworkingContracts.status, "en_cours"));

  const today = new Date();
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

  return NextResponse.json({
    ranAt: today.toISOString(),
    contracts: ongoing.length,
    createdCount: created.length,
    skippedCount: skipped.length,
    errorCount: errors.length,
    created,
    skipped,
    errors,
  });
}
