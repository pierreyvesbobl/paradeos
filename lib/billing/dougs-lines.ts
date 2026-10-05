/**
 * Forme d'une ligne de facture/devis Dougs. Module pur — pas de DB, pas d'API.
 *
 * Vit ici et pas dans `milestones-math.ts` parce que les trois marques en ont
 * besoin : les jalons projet facturent au forfait, le coworking au mois. Le
 * type était initialement figé sur `unit: "forfait"` / `quantity: 1`, ce qui
 * décrivait le seul appelant de l'époque plutôt que le contrat de l'API Dougs.
 */

export type DougsInvoiceLine = {
  title: string;
  /** Texte libre affiché sous le titre. Dougs l'accepte vide. */
  description: string;
  /** Valeurs usuelles : `forfait`, `mois`, `jour`, `heure`, `unité`. Dougs
   *  accepte du texte libre mais l'affiche tel quel sur le PDF. */
  unit: string;
  quantity: number;
  /** Prix unitaire HT. `amount` doit valoir `quantity × unitAmount`. */
  unitAmount: number;
  /** Décimal, pas un pourcentage : 0.2 et non 20. */
  vatRate: number;
  discount: 0;
  discountUnit: "%";
  reference: null;
  amount: number;
  discountInEuros: 0;
  isPriceWithVat: false;
};

/**
 * Construit une ligne en remplissant les champs que Dougs attend toujours à
 * l'identique (pas de remise, prix saisis HT) et en calculant `amount`, pour
 * qu'aucun appelant ne puisse laisser le total désaccordé du unitaire.
 */
export function dougsLine(args: {
  title: string;
  description: string;
  unit: string;
  quantity: number;
  unitAmount: number;
  vatRate: number;
}): DougsInvoiceLine {
  return {
    title: args.title,
    description: args.description,
    unit: args.unit,
    quantity: args.quantity,
    unitAmount: args.unitAmount,
    vatRate: args.vatRate,
    discount: 0,
    discountUnit: "%",
    reference: null,
    // Arrondi au centime : `desks × prix × mois` peut produire un flottant
    // sale (ex. 3 × 199.9 × 3), et Dougs recalcule ses totaux depuis `amount`.
    amount: Math.round(args.quantity * args.unitAmount * 100) / 100,
    discountInEuros: 0,
    isPriceWithVat: false,
  };
}
