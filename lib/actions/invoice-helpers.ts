import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { coworkingContracts } from "@/db/schema/coworking";
import { projects } from "@/db/schema/projects";
import type { db } from "@/lib/db/server";

/**
 * Helpers partagés par les Server Actions de facturation
 * (`invoices.ts`, `invoice-dougs-links.ts`). Pas de "use server" ici :
 * un fichier marqué ainsi expose chaque export comme endpoint, et ces
 * fonctions prennent une connexion en paramètre.
 */

/**
 * Conditions de facturation du deal auquel la facture est rattachée : le projet
 * client, ou le contrat coworking. `null` si la facture n'est rattachée à
 * aucun des deux (facture libre) — on retombe alors sur les défauts de marque.
 */
export async function loadDealBillingTerms(
  conn: Awaited<ReturnType<typeof db>>,
  link: { projectId: string | null; coworkingContractId: string | null },
): Promise<unknown> {
  if (link.projectId) {
    const [row] = await conn
      .select({ terms: projects.billingTerms })
      .from(projects)
      .where(eq(projects.id, link.projectId))
      .limit(1);
    return row?.terms ?? null;
  }
  if (link.coworkingContractId) {
    const [row] = await conn
      .select({ terms: coworkingContracts.billingTerms })
      .from(coworkingContracts)
      .where(eq(coworkingContracts.id, link.coworkingContractId))
      .limit(1);
    return row?.terms ?? null;
  }
  return null;
}

export async function resolveProjectOwner(
  conn: Awaited<ReturnType<typeof db>>,
  projectId: string | null | undefined,
): Promise<string | null> {
  if (!projectId) return null;
  const [row] = await conn
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row?.ownerId ?? null;
}

/** Coverage des paths Next.js qu'une mutation d'invoice doit refresh. */
export function revalidatePathsForInvoice(
  projectId: string | null | undefined,
  coworkingContractId: string | null | undefined,
  _invoiceId: string,
) {
  if (projectId) {
    revalidatePath(`/projets/${projectId}`);
  }
  if (coworkingContractId) {
    revalidatePath(`/coworking/contrats/${coworkingContractId}`);
    revalidatePath("/coworking");
  }
}
