/**
 * Ce qu'un nom de fichier Drive dit d'une réunion.
 *
 * Google Meet nomme ses transcripts de façon très régulière :
 *
 *   Badr Bouslikhin et Pierre-Yves Sage - 2026/07/03 10:28 CEST - Transcript
 *   Point hebdo GpasPlus - 2026/07/03 10:28 CEST - Notes de la réunion
 *
 * Le nom porte donc trois choses que le transcript, lui, ne dit
 * presque jamais : quand la réunion a eu lieu, avec qui, et sur quoi.
 * Tant qu'on se contentait de recopier le nom dans `title`, la date de
 * la réunion valait la date d'ingestion et le modèle devait deviner les
 * prénoms — d'où des réunions classées au mauvais jour et des
 * participants inventés.
 *
 * Ce module est pur : il lit un nom et rend ce qu'il a compris, sans
 * toucher à la base. Ce qui n'est pas explicite reste `null` — mieux
 * vaut un champ vide qu'un rattachement inventé.
 */

/** Ce que le nom de fichier déclare, avant tout rapprochement en base. */
export type ParsedDriveTranscriptName = {
  /** Titre lisible : le nom débarrassé de l'horodatage et du suffixe. */
  title: string;
  /** Début de la réunion, fuseau résolu. `null` si le nom n'en porte pas. */
  occurredAt: Date | null;
  /**
   * Personnes nommées dans le titre. Non vide seulement quand Meet a
   * nommé le fichier d'après ses participants (« A et B »), jamais quand
   * le titre est un sujet de réunion.
   */
  participants: string[];
  /**
   * Titre à rapprocher d'un projet existant, quand ce n'en est pas une
   * liste de personnes. `null` sinon.
   */
  projectHint: string | null;
};

/** Fuseau supposé quand le nom n'en donne aucun. */
const DEFAULT_TIME_ZONE = "Europe/Paris";

/**
 * Segments de queue produits par Meet / Gemini / les copies Drive. Ils
 * disent la nature du fichier, pas celle de la réunion : « Transcript »,
 * « Notes de la réunion », « Notes par Gemini ».
 */
const NOISE_SEGMENT =
  /^(?:transcript(?:ion)?|notes?(?:\s+(?:de\s+la\s+r[eé]union|par\s+[\p{L}\s]+))?|compte[-\s]?rendu|r[eé]sum[eé]|recording|enregistrement|gemini|copie|copy)$/iu;

/** Extensions des transcripts texte ; un Google Doc natif n'en a pas. */
const TEXT_EXTENSION = /\.(?:txt|md|markdown|docx?|rtf|vtt|srt)$/i;

/** Suffixe de copie Drive : « … (1) », « … - Copie de … ». */
const COPY_SUFFIX = /\s*\((\d{1,2})\)\s*$/;

/**
 * Mots qui disent le genre d'une réunion, pas le nom d'une personne.
 * Sans cette liste, « Point Hebdo » passerait pour un prénom-nom.
 */
const NOT_A_NAME = new Set([
  "point",
  "hebdo",
  "reunion",
  "meeting",
  "call",
  "visio",
  "atelier",
  "workshop",
  "brief",
  "debrief",
  "kickoff",
  "kick",
  "off",
  "suivi",
  "comite",
  "copil",
  "entretien",
  "demo",
  "weekly",
  "daily",
  "monthly",
  "standup",
  "retro",
  "sprint",
  "projet",
  "project",
  "rdv",
  "rendez",
  "vous",
  "devis",
  "facture",
  "onboarding",
  "formation",
  "recrutement",
  "note",
  "notes",
]);

/** `Nom`, `Pierre-Yves`, `O'Brien` — commence par une majuscule. */
const NAME_TOKEN = /^\p{Lu}[\p{L}'’.-]*$/u;

/** « A et B », « A, B », « A & B », « A and B ». */
const PEOPLE_SEPARATOR = /\s*(?:,|&|\+)\s*|\s+(?:et|and)\s+/;

export function parseDriveTranscriptName(
  fileName: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): ParsedDriveTranscriptName {
  const base = fileName
    .replace(TEXT_EXTENSION, "")
    .replace(COPY_SUFFIX, "")
    .replace(/\s+/g, " ")
    .trim();

  const segments = base.split(/\s+-\s+/).filter((s) => s.length > 0);

  let occurredAt: Date | null = null;
  let stampIndex = -1;
  for (const [i, segment] of segments.entries()) {
    const parsed = parseMeetingStamp(segment, timeZone);
    if (parsed) {
      occurredAt = parsed;
      stampIndex = i;
      break;
    }
  }

  // Avant l'horodatage : le titre. Après : le type de fichier. Sans
  // horodatage, tout le nom est candidat et on retire juste la queue.
  const head = stampIndex >= 0 ? segments.slice(0, stampIndex) : segments;
  const kept = head.filter((s) => !NOISE_SEGMENT.test(s));
  const title = (kept.length > 0 ? kept : head).join(" - ").trim() || base;

  const participants = parsePeopleList(title);

  return {
    title,
    occurredAt,
    participants,
    // Une liste de personnes n'est pas un nom de projet : proposer
    // « Badr Bouslikhin et Pierre-Yves Sage » au rapprochement projet ne
    // pourrait que produire un faux positif.
    projectHint: participants.length > 0 ? null : title || null,
  };
}

/**
 * Découpe un titre en personnes, ou rend `[]` si ce n'en est pas une
 * liste. On exige au moins deux personnes : Meet ne nomme un fichier
 * d'après ses participants qu'à partir de deux, et un titre à une seule
 * entrée (« Nextase ») est un sujet, pas quelqu'un.
 */
export function parsePeopleList(title: string): string[] {
  const chunks = title
    .split(PEOPLE_SEPARATOR)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (chunks.length < 2) return [];
  if (!chunks.every(looksLikePersonName)) return [];
  // Dédup sur la casse : « Badr et badr » ne fait pas deux personnes.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chunk of chunks) {
    const key = chunk.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chunk);
  }
  return out;
}

function looksLikePersonName(chunk: string): boolean {
  const tokens = chunk.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 4) return false;
  return tokens.every((token) => {
    if (!NAME_TOKEN.test(token)) return false;
    const plain = token
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    return !NOT_A_NAME.has(plain);
  });
}

/**
 * Décalages des abréviations de fuseau qu'on peut lire sans ambiguïté.
 * `IST` (Irlande / Israël / Inde) et `CST` (US / Chine) n'y sont pas :
 * mieux vaut retomber sur le fuseau par défaut que placer la réunion à
 * huit heures de là.
 */
const NAMED_OFFSET_MINUTES: Record<string, number> = {
  utc: 0,
  gmt: 0,
  z: 0,
  wet: 0,
  west: 60,
  cet: 60,
  cest: 120,
  bst: 60,
  eet: 120,
  eest: 180,
  msk: 180,
  est: -300,
  edt: -240,
  cdt: -300,
  mst: -420,
  mdt: -360,
  pst: -480,
  pdt: -420,
  akst: -540,
  akdt: -480,
  hst: -600,
  aest: 600,
  aedt: 660,
  awst: 480,
  nzst: 720,
  nzdt: 780,
  jst: 540,
  kst: 540,
  sgt: 480,
  hkt: 480,
};

const STAMP =
  /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{2,4})(?:[\s,T]+(\d{1,2})[:h.](\d{2})(?::(\d{2}))?)?\s*(?:(?:am|pm)\s*)?(.*)$/i;

/**
 * Lit un horodatage de nom de fichier et le rend en instant UTC.
 *
 * Accepte `2026/07/03 10:28 CEST` (Meet), `2026-07-03 10:28`,
 * `03/07/2026 10h28`. Sans heure, on pose midi dans le fuseau : minuit
 * retomberait la veille dès qu'on relit la date ailleurs.
 *
 * Exporté pour les tests — l'ingestion passe par
 * `parseDriveTranscriptName`.
 */
export function parseMeetingStamp(
  value: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): Date | null {
  const match = STAMP.exec(value.trim());
  if (!match) return null;
  const [, a, b, c, hh, mm, , zoneRaw] = match;
  if (!a || !b || !c) return null;

  const ymd = resolveYmd(a, b, c);
  if (!ymd) return null;

  const hasTime = hh !== undefined && mm !== undefined;
  const hours = hasTime ? Number(hh) : 12;
  const minutes = hasTime ? Number(mm) : 0;
  if (hours > 23 || minutes > 59) return null;

  const zone = (zoneRaw ?? "").trim();
  // Un reste qui n'est pas un fuseau veut dire qu'on n'a pas lu un
  // horodatage mais autre chose qui y ressemble. On refuse.
  const offset = zone.length > 0 ? parseZoneOffsetMinutes(zone) : null;
  if (zone.length > 0 && offset === null) return null;

  const naive = Date.UTC(ymd.year, ymd.month - 1, ymd.day, hours, minutes);
  // Un 31/02 se replie sur mars : on refuse plutôt que d'inventer.
  const check = new Date(naive);
  if (check.getUTCMonth() !== ymd.month - 1 || check.getUTCDate() !== ymd.day) return null;

  if (offset !== null) return new Date(naive - offset * 60_000);
  return new Date(naive - zoneOffsetMinutes(new Date(naive), timeZone, naive) * 60_000);
}

/**
 * `2026/07/03` (ISO, ce que fait Meet) ou `03/07/2026` (français). Les
 * dates entièrement à deux chiffres sont lues jour/mois/année : c'est la
 * convention locale, et l'ambiguïté avec le format américain n'a jamais
 * de bonne réponse.
 */
function resolveYmd(
  a: string,
  b: string,
  c: string,
): { year: number; month: number; day: number } | null {
  let year: number;
  let month: number;
  let day: number;
  if (a.length === 4) {
    year = Number(a);
    month = Number(b);
    day = Number(c);
  } else if (c.length === 4) {
    day = Number(a);
    month = Number(b);
    year = Number(c);
  } else {
    day = Number(a);
    month = Number(b);
    year = 2000 + Number(c);
  }
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** `CEST`, `GMT+2`, `UTC+02:00`, `+0200`. `null` si illisible. */
export function parseZoneOffsetMinutes(raw: string): number | null {
  const value = raw.trim().replace(/[()]/g, "");
  if (value.length === 0) return null;

  const explicit = /^(?:gmt|utc)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(value);
  if (explicit) {
    const sign = explicit[1] === "-" ? -1 : 1;
    const hours = Number(explicit[2]);
    const minutes = Number(explicit[3] ?? 0);
    if (hours > 14 || minutes > 59) return null;
    return sign * (hours * 60 + minutes);
  }

  const key = value.toLowerCase();
  return Object.hasOwn(NAMED_OFFSET_MINUTES, key) ? (NAMED_OFFSET_MINUTES[key] as number) : null;
}

/**
 * Décalage d'un fuseau nommé à un instant donné, en minutes.
 *
 * Une heure locale ne se convertit pas en une passe : pour connaître le
 * décalage il faut déjà l'instant, et pour l'instant il faut le
 * décalage. On part du décalage lu à l'heure naïve, on corrige, et on
 * re-vérifie une fois — ce qui suffit partout sauf dans l'heure sautée
 * d'un changement d'heure, où aucune réponse n'est juste.
 */
function zoneOffsetMinutes(instant: Date, timeZone: string, naive: number): number {
  const first = readOffset(instant, timeZone);
  const second = readOffset(new Date(naive - first * 60_000), timeZone);
  return second;
}

function readOffset(instant: Date, timeZone: string): number {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value;
    const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name ?? "");
    if (!match) return 0;
    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
  } catch {
    return 0;
  }
}
