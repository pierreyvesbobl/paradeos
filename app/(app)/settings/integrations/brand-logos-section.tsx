import type { InvoiceBrand } from "@/db/schema/invoices";
import { getBrandLogoUuid } from "@/lib/billing/brand-documents";
import { INVOICE_BRAND_LABELS } from "@/lib/billing/brand-templates";
import { brandTemplateFor } from "@/lib/billing/brand-templates";
import { BrandLogosSettings } from "./brand-logos-settings";

const BRANDS: InvoiceBrand[] = ["coworking", "automato", "parade"];

/**
 * Logos imprimés sur les devis et factures, une image par marque.
 *
 * Le logo n'est pas stocké chez nous : il est téléversé chez Dougs, seul
 * endroit où `logoUuid` a un sens, et on ne garde que l'UUID. L'aperçu passe
 * par le proxy `/api/dougs/file/{uuid}`, parce que le navigateur n'a pas de
 * session Dougs.
 */
export async function BrandLogosSection() {
  const brands = await Promise.all(
    BRANDS.map(async (brand) => ({
      brand,
      label: INVOICE_BRAND_LABELS[brand],
      /** Réglé en base, donc modifiable sans déploiement. */
      configured: await getBrandLogoUuid(brand),
      /** Replis successifs, du plus spécifique au plus général. */
      pinned: brandTemplateFor(brand).document.logoUuid ?? null,
    })),
  );

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4">
        <h2 className="font-medium text-sm">Logos par marque</h2>
        <p className="mt-1 text-muted-foreground text-xs">
          Imprimé sur les devis et les factures de chaque marque. Déposer une image la téléverse
          chez Dougs ; Parade OS n'en garde que la référence.
        </p>
        <p className="mt-1 text-muted-foreground text-xs">
          L'image est recadrée sur un gabarit commun (600 × 200, fond transparent) avant envoi :
          Dougs adapte le logo à une boîte de proportions fixes, donc sans ce gabarit deux logos de
          formats différents n'occupent pas la même place sur le document.
        </p>
        <p className="mt-1 text-muted-foreground text-xs">
          Épingler un logo par marque est volontaire : le logo « par défaut » des réglages Dougs est
          global à la société, donc le changer pour une marque repeint les documents de toutes les
          autres.
        </p>
      </header>
      <BrandLogosSettings brands={brands} />
    </section>
  );
}
