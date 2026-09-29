/**
 * Contexte déclaré à la main dans un mail de réunion.
 *
 * Le transcript dit ce qui s'est raconté, pas toujours de quoi il
 * s'agit : « on valide le devis » ne nomme ni le projet, ni la société,
 * et « Marie » ne dit pas quelle Marie. L'expéditeur, lui, le sait au
 * moment où il transfère. Ces directives lui donnent un endroit où
 * l'écrire, en objet ou en tête du mail :
 *
 *   Objet : Point hebdo [projet: GpasPlus] [avec: Marie Testard, Éric]
 *
 *   ou, dans le corps, avant le transcript :
 *     Projet : GpasPlus - Automatisation
 *     Participants : Marie Testard <marie@fictiva.fr>, Éric
 *     Date : 12/03/2026
 *
 * Ce qui est déclaré n'est pas deviné : les participants partent en base
 * avant l'extraction, donc le modèle les lit au lieu de les inventer.
 */

export type EmailDirectives = {
  /** Remplace le titre tiré de l'objet. */
  title: string | null;
  /** Nom de projet à rapprocher de l'existant. */
  projectHint: string | null;
  participants: Array<{ name: string; email: string | null }>;
  /** Date de la réunion, à midi UTC pour ne pas glisser d'un jour. */
  occurredAt: Date | null;
};

export type ParsedEmailContext = EmailDirectives & {
  /** L'objet débarrassé de ses `[clé: valeur]`. */
  subject: string | null;
  /** Le corps débarrassé de son entête de directives. */
  body: string;
};

/** Clés acceptées, accents et casse indifférents. */
const KEYS: Record<string, keyof EmailDirectives> = {
  titre: "title",
  title: "title",
  projet: "projectHint",
  project: "projectHint",
  participants: "participants",
  participant: "participants",
  avec: "participants",
  presents: "participants",
  présents: "participants",
  date: "occurredAt",
  le: "occurredAt",
};

function normalizeKey(raw: string): keyof EmailDirectives | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "");
  return KEYS[key] ?? null;
}

/**
 * Une personne par virgule ou point-virgule, `Nom <email>` accepté. Les
 * parenthèses (« Marie (Fictiva) ») sont retirées du nom : elles disent
 * d'où vient la personne, pas comment elle s'appelle.
 */
function parseParticipants(value: string): Array<{ name: string; email: string | null }> {
  const out: Array<{ name: string; email: string | null }> = [];
  for (const chunk of value.split(/[,;]/)) {
    const raw = chunk.trim();
    if (raw.length === 0) continue;
    const withEmail = raw.match(/^(.*?)[<(]\s*([^>)\s]+@[^>)\s]+)\s*[>)]\s*$/);
    const name = (withEmail?.[1] ?? raw)
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (name.length < 2) continue;
    out.push({ name, email: withEmail?.[2]?.toLowerCase() ?? null });
  }
  return out;
}

/**
 * `12/03/2026`, `12/03` (année en cours), `2026-03-12`. Midi UTC :
 * minuit tomberait la veille dès qu'on repasse en heure locale.
 */
export function parseDirectiveDate(value: string, today: Date = new Date()): Date | null {
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const fr = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (fr) {
    const year = fr[3] ? normalizeYear(Number(fr[3])) : today.getUTCFullYear();
    return buildDate(year, Number(fr[2]), Number(fr[1]));
  }
  return null;
}

function normalizeYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

function buildDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  // Un 31/02 se replie sur mars : on refuse plutôt que d'inventer.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

const SUBJECT_DIRECTIVE = /\[\s*([\p{L}]+)\s*:\s*([^\]]+)\]/gu;
const BODY_DIRECTIVE = /^\s*([\p{L}]+)\s*:\s*(.+?)\s*$/u;

/**
 * Lit les directives de l'objet puis de l'entête du corps, et rend les
 * deux nettoyés. Le corps l'emporte sur l'objet : c'est là qu'on écrit
 * quand on prend le temps de préciser.
 */
export function parseEmailContext(
  subject: string | null,
  body: string,
  today: Date = new Date(),
): ParsedEmailContext {
  const directives: EmailDirectives = {
    title: null,
    projectHint: null,
    participants: [],
    occurredAt: null,
  };

  const apply = (rawKey: string, rawValue: string) => {
    const key = normalizeKey(rawKey);
    if (!key) return false;
    const value = rawValue.trim();
    if (value.length === 0) return false;
    if (key === "participants") {
      directives.participants = [...directives.participants, ...parseParticipants(value)];
      return true;
    }
    if (key === "occurredAt") {
      const date = parseDirectiveDate(value, today);
      if (!date) return false;
      directives.occurredAt = date;
      return true;
    }
    directives[key] = value;
    return true;
  };

  // ---- Objet : les `[clé: valeur]` sortent du titre.
  let cleanedSubject = subject;
  if (subject) {
    cleanedSubject = subject
      .replace(SUBJECT_DIRECTIVE, (match, key: string, value: string) =>
        apply(key, value) ? "" : match,
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  // ---- Corps : les premières lignes `clé : valeur`, jusqu'à la
  // première qui n'en est pas une. Au-delà, on est dans le transcript et
  // « Pierre-Yves : on valide » n'est pas une directive.
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let cursor = 0;
  let consumed = 0;
  while (cursor < lines.length) {
    const line = lines[cursor] ?? "";
    if (line.trim().length === 0) {
      // Une ligne vide ne coupe l'entête que si rien n'a encore été lu.
      if (consumed === 0 && cursor < 3) {
        cursor++;
        continue;
      }
      if (consumed > 0) {
        cursor++;
        break;
      }
      break;
    }
    const match = line.match(BODY_DIRECTIVE);
    if (!match || !apply(match[1] as string, match[2] as string)) break;
    consumed++;
    cursor++;
  }

  return {
    ...directives,
    subject: cleanedSubject && cleanedSubject.length > 0 ? cleanedSubject : null,
    body: consumed > 0 ? lines.slice(cursor).join("\n").trim() : body,
  };
}
