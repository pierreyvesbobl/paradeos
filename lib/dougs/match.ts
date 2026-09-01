import { personNameOrNull } from "@/lib/format";

/**
 * Scoring de rapprochement Dougs ↔ Paradeos. Combine 3 signaux :
 *  - similarité nom client (50 %)
 *  - proximité montant (30 %)
 *  - proximité date (20 %)
 *
 * Renvoie un score [0, 1]. Au-dessus de 0.6 = candidat proposable ;
 * 0.85+ = très probablement un match.
 */

function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Token-based Jaccard sur les mots normalisés + bonus inclusion totale.
 *
 * Cas testés :
 *  - "ACME SAS" vs "Acme S.A.S." → 1 (Jaccard fort)
 *  - "Acme" vs "Acme SAS Holdings" → 0.95 (inclusion totale, un côté est
 *    sous-chaîne complète de l'autre — Jaccard seul donnerait 1/3)
 *  - "Arthur Heynard" vs "Heynard Arthur" → 1 (Jaccard ignore l'ordre)
 *  - "Cabinet Dupont" vs "Dupont Conseil" → 0.33 (1 mot commun /3)
 */
export function similarityName(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  // Inclusion totale d'une chaîne dans l'autre — match probable.
  // "acme" inclus dans "acme sas holdings" → 0.95
  if (na.length >= 3 && nb.length >= 3) {
    if (nb.includes(na) || na.includes(nb)) {
      return 0.95;
    }
  }

  // Jaccard sur tokens significatifs (≥2 chars), strippe les acronymes
  // d'une lettre type "S.A.S" devenu "s a s" après normalisation.
  const ta = new Set(na.split(" ").filter((w) => w.length >= 2));
  const tb = new Set(nb.split(" ").filter((w) => w.length >= 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const union = ta.size + tb.size - inter;
  const jaccard = inter / union;

  // Bonus : si tous les tokens d'un côté sont dans l'autre, c'est
  // probablement un match (ex : "Acme" → tous les tokens de "Acme" sont
  // dans "Acme SAS"). On élève le score à au moins 0.7.
  const allInB = [...ta].every((w) => tb.has(w));
  const allInA = [...tb].every((w) => ta.has(w));
  if ((allInB || allInA) && jaccard > 0) {
    return Math.max(jaccard, 0.7);
  }

  return jaccard;
}

/**
 * Similarité de montants en € HT (tolérance ±5 %). Renvoie 1 si écart
 * ≤ 1 %, 0 si écart ≥ 20 %, linéaire entre les deux.
 */
export function similarityAmount(
  a: number | null | undefined,
  b: number | null | undefined,
): number {
  if (typeof a !== "number" || typeof b !== "number" || a <= 0 || b <= 0) return 0;
  const diff = Math.abs(a - b) / Math.max(a, b);
  if (diff <= 0.01) return 1;
  if (diff >= 0.2) return 0;
  return 1 - (diff - 0.01) / 0.19;
}

/**
 * Pourcentages "standards" d'une facture par rapport au total projet :
 * acompte 30/40/50, solde 50/60/70, full 100. Si le ratio facture/projet
 * tombe près de l'un d'eux (±3 pts), c'est un match probable acompte/solde.
 */
const STANDARD_PERCENTS = [30, 40, 50, 60, 70, 100] as const;

/**
 * Similarité "partielle" entre une facture et le total d'un projet.
 * Calcule le ratio facture/total et vérifie s'il est proche d'un
 * pourcentage standard (acompte/solde/full). Renvoie aussi le %
 * détecté pour pouvoir créer un jalon avec le bon label.
 *
 * - 100 % à ±3 pts → score 1
 * - écart de 10 pts → score ~0.3
 * - écart ≥ 20 pts → score 0
 */
export function similarityAmountPartial(
  invoiceAmount: number | null | undefined,
  projectAmount: number | null | undefined,
): { score: number; percent: number | null } {
  if (
    typeof invoiceAmount !== "number" ||
    typeof projectAmount !== "number" ||
    invoiceAmount <= 0 ||
    projectAmount <= 0
  ) {
    return { score: 0, percent: null };
  }
  const ratio = (invoiceAmount / projectAmount) * 100;
  // On test contre chaque pourcentage standard, on garde le meilleur.
  let best = { score: 0, percent: null as number | null };
  for (const std of STANDARD_PERCENTS) {
    const gap = Math.abs(ratio - std);
    let s = 0;
    if (gap <= 3) s = 1;
    else if (gap >= 20) s = 0;
    else s = 1 - (gap - 3) / 17;
    if (s > best.score) {
      best = { score: s, percent: std };
    }
  }
  return best;
}

/**
 * Similarité de dates : 1 si <= 7 jours d'écart, 0 si >= 180 jours.
 */
export function similarityDate(
  a: Date | string | null | undefined,
  b: Date | string | null | undefined,
): number {
  if (!a || !b) return 0;
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
  const days = Math.abs(da.getTime() - db.getTime()) / (24 * 3600 * 1000);
  if (days <= 7) return 1;
  if (days >= 180) return 0;
  return 1 - (days - 7) / 173;
}

export type MatchScore = {
  total: number;
  name: number;
  amount: number;
  date: number;
  /**
   * Vrai si le candidat a été écarté par le plancher de nom. Le détail
   * des sous-scores reste renseigné pour le mode debug de la page
   * Rapprochement.
   */
  rejectedOnName?: boolean;
};

/**
 * Plancher de similarité de nom. En dessous, un candidat n'est pas
 * proposable **quels que soient** le montant et la date.
 *
 * Pourquoi un plancher et pas seulement un poids : avec la pondération
 * seule, un candidat dont le nom ne correspond à rien (nom = 0) mais
 * dont le montant et la date coïncident sortait à 0 × 0,5 + 1 × 0,3 +
 * 1 × 0,2 = **0,5**, donc au-dessus du seuil de proposition de 0,3.
 *
 * En pratique ça mélangeait coworking et projets clients : les loyers
 * coworking sont des montants ronds et récurrents (600, 750, 3000 €),
 * souvent identiques d'un contrat à l'autre et émis en début de mois.
 * N'importe quelle facture Dougs du même montant tombait donc sur le
 * premier contrat venu. Le montant et la date ne sont pas des preuves
 * d'identité : sans un minimum d'accord sur le nom, il n'y a pas de
 * candidat.
 *
 * 0,35 laisse passer un token commun sur trois (« Cabinet Dupont » vs
 * « Dupont Conseil » = 0,33 est écarté, un token sur deux = 0,5 passe).
 */
export const NAME_MATCH_FLOOR = 0.35;

/** Nom client tel que Dougs le porte, quelle que soit la forme du payload. */
function dougsClientName(dougs: {
  legalName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string | null {
  if (dougs.legalName?.trim()) return dougs.legalName.trim();
  return personNameOrNull(dougs.firstName, dougs.lastName);
}

export function scoreMatch(
  dougs: {
    legalName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    amount?: number | null;
    createdAt?: string | null;
  },
  paradeos: {
    clientName?: string | null;
    amount?: number | null;
    date?: string | Date | null;
  },
): MatchScore {
  const name = similarityName(dougsClientName(dougs), paradeos.clientName);
  const amount = similarityAmount(dougs.amount, paradeos.amount);
  const date = similarityDate(dougs.createdAt, paradeos.date);
  if (name < NAME_MATCH_FLOOR) {
    return { total: 0, name, amount, date, rejectedOnName: true };
  }
  const total = name * 0.5 + amount * 0.3 + date * 0.2;
  return { total: Math.round(total * 1000) / 1000, name, amount, date };
}

/**
 * Score une facture Dougs contre plusieurs identités possibles du même
 * candidat Paradeos, et garde la meilleure.
 *
 * Un contrat coworking peut être facturé sous plusieurs noms selon la
 * config (entité de facturation, entreprise du coworker, le coworker
 * lui-même, le libellé du contrat) — d'où la liste plutôt qu'un nom
 * unique.
 */
export function scoreMatchBest(
  dougs: Parameters<typeof scoreMatch>[0],
  clientNames: readonly (string | null | undefined)[],
  paradeos: { amount?: number | null; date?: string | Date | null },
): MatchScore {
  let best: MatchScore | null = null;
  for (const clientName of clientNames.length > 0 ? clientNames : [null]) {
    const s = scoreMatch(dougs, { clientName, amount: paradeos.amount, date: paradeos.date });
    if (!best || s.total > best.total || (s.total === best.total && s.name > best.name)) {
      best = s;
    }
  }
  return best ?? { total: 0, name: 0, amount: 0, date: 0, rejectedOnName: true };
}
