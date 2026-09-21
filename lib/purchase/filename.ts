/**
 * Lecture des noms de fichiers du Drive « Factures Achats ». Module pur
 * (pas de `server-only`) : testable, et appelé par l'inventaire.
 *
 * Deux chaînes déposent dans ce dossier, avec deux conventions :
 *
 *   Parade OS  `AAMMJJ_facture_Prestation_Fournisseur.pdf`
 *              (cf. `buildInvoiceFilename` dans lib/gmail/invoice-extract.ts)
 *   l'ancienne `AAMMJJ_facture_fournisseur`  — souvent sans extension,
 *              avec parfois une date à 8 chiffres (`26022026_facture_…`)
 *
 * Les deux convergent sur un point qui sert de règle : le fournisseur est
 * le dernier segment. Le nom de fichier reste une source faible — quand
 * le fichier vit dans un dossier fournisseur, c'est le dossier qui fait
 * autorité (cf. `lib/purchase/inventory.ts`).
 */

export type ParsedPurchaseFilename = {
  invoiceDate: Date | null;
  supplierLabel: string | null;
};

/** Sépare le nom de son extension. `260401_facture_ovh` n'en a pas. */
function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return name;
  const ext = name.slice(dot + 1);
  // Une "extension" de plus de 5 caractères est probablement un bout de
  // nom ("Facture.Mars2026"), pas un suffixe de type.
  return ext.length <= 5 && /^[a-z0-9]+$/i.test(ext) ? name.slice(0, dot) : name;
}

/** Date réelle ou `null`. Refuse le 31 février comme le mois 13. */
function makeDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

/**
 * Le token de date en tête de nom. `AAMMJJ` est la convention ; les 8
 * chiffres sont une malformation de l'ancienne chaîne, qu'on lit en
 * `JJMMAAAA` puis, à défaut, en `AAAAMMJJ`.
 */
function parseDateToken(token: string): Date | null {
  if (/^\d{6}$/.test(token)) {
    const yy = Number(token.slice(0, 2));
    return makeDate(2000 + yy, Number(token.slice(2, 4)), Number(token.slice(4, 6)));
  }
  if (/^\d{8}$/.test(token)) {
    const asDdMmYyyy = makeDate(
      Number(token.slice(4, 8)),
      Number(token.slice(2, 4)),
      Number(token.slice(0, 2)),
    );
    if (asDdMmYyyy) return asDdMmYyyy;
    return makeDate(
      Number(token.slice(0, 4)),
      Number(token.slice(4, 6)),
      Number(token.slice(6, 8)),
    );
  }
  return null;
}

const FACTURE_SEGMENT = /^factures?$/i;

export function parsePurchaseFilename(name: string): ParsedPurchaseFilename {
  const segments = stripExtension(name.trim())
    .split("_")
    .map((s) => s.trim())
    .filter(Boolean);

  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) return { invoiceDate: null, supplierLabel: null };

  const invoiceDate = parseDateToken(first);

  // Le fournisseur est le dernier segment, à condition qu'il ne soit ni
  // la date ni le littéral "facture" — sinon il n'y a pas de fournisseur
  // dans le nom (`260401_facture`).
  const isOnlyMarkers = segments.length <= 1 || FACTURE_SEGMENT.test(last) || /^\d+$/.test(last);

  return {
    invoiceDate,
    supplierLabel: isOnlyMarkers ? null : last,
  };
}
