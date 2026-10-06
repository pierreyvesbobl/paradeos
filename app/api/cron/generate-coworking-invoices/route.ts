import { eq } from "drizzle-orm";
import { coworkingContracts } from "@/db/schema/coworking";
import { generateNextInvoiceForContract } from "@/lib/coworking/generate-invoice";
import { cronResponse, cronUnauthorized } from "@/lib/cron/auth";
import { db } from "@/lib/db/server";

/**
 * Cron mensuel du coworking : **génération seulement**.
 *
 * Crée une facture `draft` pour chaque contrat `en_cours` dont la période
 * suivante est due, en respectant la fréquence de chacun — mensuelle ou
 * trimestrielle. Idempotent : si la facture de la période existe déjà (bouton
 * manuel ou run précédent), la période calculée tomberait dans le futur et le
 * helper la skip. L'index unique `invoices_coworking_period_uidx` est le
 * garde-fou de dernier recours.
 *
 * **L'envoi n'est plus ici.** Il dépend du cookie de session Dougs, rafraîchi
 * par l'extension Chrome quand Chrome tourne : à 6 h du matin, sans personne
 * devant la machine, sa validité est un pari. Et notre `expires_at` n'est
 * qu'une estimation à 24 h, pas une mesure — on ne peut donc même pas savoir à
 * l'avance si l'envoi passera. L'envoi est devenu une action groupée, déclenchée
 * depuis la page Coworking quand la session est fraîche : cf.
 * `sendDueCoworkingInvoices` dans `lib/actions/coworking.ts`.
 *
 * La génération, elle, ne touche pas à Dougs et peut donc rester automatique.
 *
 * Auth : `Authorization: Bearer <CRON_SECRET>`. Vercel pose le header
 * automatiquement quand `CRON_SECRET` est défini.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = cronUnauthorized(request);
  if (unauthorized) return unauthorized;

  const _dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
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

  return cronResponse({
    ranAt: today.toISOString(),
    contracts: ongoing.length,
    succeeded: created.length + skipped.length,
    failed: errors.length,
    created,
    skipped,
    errors,
  });
}
