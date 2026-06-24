import { fnv1a } from "./hash";

const COMPANIES = [
  "Atelier Démo",
  "Studio Échantillon",
  "Maison Exemple",
  "Agence Témoin",
  "Bureau Modèle",
  "Cabinet Spécimen",
  "Comptoir Démo",
  "Édition Test",
  "Fabrique Échantillon",
  "Forge Exemple",
  "Galerie Témoin",
  "Industrie Modèle",
  "Manufacture Spécimen",
  "Pôle Démo",
  "Studio Test",
  "Atelier Échantillon",
  "Maison Exemple",
  "Agence Démo",
  "Cabinet Témoin",
  "Comptoir Modèle",
  "Édition Spécimen",
  "Fabrique Démo",
  "Forge Test",
  "Galerie Échantillon",
  "Industrie Exemple",
  "Manufacture Témoin",
  "Pôle Modèle",
  "Studio Spécimen",
  "Atelier Démo",
  "Maison Test",
  "Agence Échantillon",
  "Bureau Exemple",
  "Cabinet Témoin",
  "Comptoir Modèle",
  "Édition Spécimen",
  "Fabrique Démo",
  "Forge Échantillon",
  "Galerie Exemple",
  "Industrie Témoin",
  "Manufacture Modèle",
  "Pôle Spécimen",
  "Studio Démo",
  "Atelier Test",
  "Maison Échantillon",
  "Agence Exemple",
  "Bureau Témoin",
  "Cabinet Modèle",
  "Comptoir Spécimen",
  "Édition Démo",
  "Fabrique Test",
];

const FIRST_NAMES = [
  "Alice",
  "Antoine",
  "Béatrice",
  "Benjamin",
  "Camille",
  "Charles",
  "Claire",
  "Clément",
  "Damien",
  "Diane",
  "Élise",
  "Émilie",
  "Étienne",
  "Fabien",
  "Florence",
  "François",
  "Gabriel",
  "Garance",
  "Hélène",
  "Hugo",
  "Inès",
  "Isabelle",
  "Jérôme",
  "Julie",
  "Julien",
  "Karim",
  "Laura",
  "Laurent",
  "Léa",
  "Lucas",
  "Manon",
  "Marc",
  "Marie",
  "Mathieu",
  "Nadia",
  "Nicolas",
  "Olivia",
  "Pascal",
  "Paul",
  "Pauline",
  "Quentin",
  "Romain",
  "Sabrina",
  "Sébastien",
  "Sophie",
  "Théo",
  "Thomas",
  "Valérie",
  "Vincent",
  "Yasmine",
];

const LAST_NAMES = [
  "Martin",
  "Bernard",
  "Thomas",
  "Petit",
  "Robert",
  "Richard",
  "Durand",
  "Dubois",
  "Moreau",
  "Laurent",
  "Simon",
  "Michel",
  "Lefèvre",
  "Leroy",
  "Roux",
  "David",
  "Bertrand",
  "Morel",
  "Fournier",
  "Girard",
  "Bonnet",
  "Dupont",
  "Lambert",
  "Fontaine",
  "Rousseau",
  "Vincent",
  "Muller",
  "Lefèvre",
  "Faure",
  "André",
  "Mercier",
  "Blanc",
  "Guérin",
  "Boyer",
  "Garnier",
  "Chevalier",
  "François",
  "Legrand",
  "Gauthier",
  "Garcia",
  "Perrin",
  "Robin",
  "Clément",
  "Morin",
  "Nicolas",
  "Henry",
  "Roussel",
  "Mathieu",
  "Gautier",
  "Masson",
];

/**
 * Renvoie un nom d'entreprise déterministe basé sur l'id.
 * Toujours le même alias pour le même id.
 */
export function demoCompanyName(id: string): string {
  const h = fnv1a(id);
  const base = COMPANIES[h % COMPANIES.length];
  const suffix = (h % 100).toString().padStart(2, "0");
  return `${base} ${suffix}`;
}

export function demoFirstName(id: string): string {
  return FIRST_NAMES[fnv1a(`first:${id}`) % FIRST_NAMES.length] ?? "Alice";
}

export function demoLastName(id: string): string {
  return LAST_NAMES[fnv1a(`last:${id}`) % LAST_NAMES.length] ?? "Martin";
}

export function demoContactName(id: string): { firstName: string; lastName: string } {
  return { firstName: demoFirstName(id), lastName: demoLastName(id) };
}

export function demoProjectName(id: string): string {
  const h = fnv1a(`proj:${id}`);
  const suffix = (h % 1000).toString().padStart(3, "0");
  return `Projet Démo ${suffix}`;
}

// Combining diacritical marks (U+0300 to U+036F). Listed via alternation so the
// linter doesn't flag a misleading character class containing combining marks.
const DIACRITICS = new RegExp(
  Array.from(
    { length: 0x36f - 0x300 + 1 },
    (_, i) => `\\u${(0x300 + i).toString(16).padStart(4, "0")}`,
  ).join("|"),
  "g",
);

export function demoEmail(id: string): string {
  const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(DIACRITICS, "");
  return `${strip(demoFirstName(id))}.${strip(demoLastName(id))}@demo.local`;
}

/**
 * Multiplie un montant par un facteur déterministe entre 0.70 et 1.40.
 * Garde les ordres de grandeur et la cohérence des courbes/totaux par ligne.
 */
export function demoAmount(id: string, real: number): number {
  const factor = 0.7 + (fnv1a(id) % 71) / 100;
  return Math.round(real * factor * 100) / 100;
}
