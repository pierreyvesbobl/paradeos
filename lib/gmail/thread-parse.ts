/**
 * Parseur de thread email : découpe un message en corps propre (ce que
 * l'expéditeur a écrit maintenant) et historique replié (les messages
 * quotés/forwardés qui étaient déjà dans le fil).
 *
 * Utile pour :
 *   - présenter proprement la vue thread (`app/(app)/emails/[threadId]`)
 *   - donner au LLM d'extraction un corps propre plutôt qu'un mail de
 *     20k caractères qui n'est en réalité qu'un forward.
 *
 * Approche : text-first. Si `bodyText` existe on parse là-dessus.
 * Si seulement `bodyHtml` on strip les tags pour obtenir du texte. On
 * détecte aussi `blockquote.gmail_quote` pour retirer les quotes du HTML
 * rendu séparément.
 *
 * Design : on regroupe **tout** l'historique en un seul bloc plutôt
 * que de tenter le split multi-niveaux — c'est robuste, ça se lit bien
 * dans une section `<details>` repliée, et ça ne casse pas silencieusement
 * sur des marqueurs exotiques.
 */

const QUOTE_MARKERS: RegExp[] = [
  // Français — Gmail / Mail.app
  /^\s*Le\s+.+?\s+a\s+(écrit|ecrit)\s*:\s*$/im,
  // Anglais — Gmail
  /^\s*On\s+.+?\s+wrote\s*:\s*$/im,
  // Outlook / Thunderbird
  /^-{3,}\s*Message d['’]origine\s*-{3,}\s*$/im,
  /^-{3,}\s*Original Message\s*-{3,}\s*$/im,
  // Forwards
  /^-{3,}\s*(Message transféré|Message transfere)\s*-{3,}\s*$/im,
  /^-{3,}\s*Forwarded message\s*-{3,}\s*$/im,
  // Bloc d'en-têtes standalone (De: / From:)
  /^\s*De\s*:\s*.+$/im,
  /^\s*From\s*:\s*.+$/im,
];

export type QuoteBlock = {
  /** Ligne d'introduction du quote (ex "Le 15 mars 2026, X a écrit :"). */
  header: string | null;
  /** Corps du message quoté (préfixes `>` retirés à tous les niveaux). */
  body: string;
};

export type ParsedThread = {
  /** Corps du message qu'on doit afficher en haut, quotes retirées. */
  cleanText: string;
  /**
   * HTML sanitisable rendu inline, avec les blockquote de type
   * `gmail_quote` supprimés. Null si pas de HTML source.
   */
  cleanHtml: string | null;
  /** Historique du fil. Actuellement 0 ou 1 bloc. Tableau pour extensibilité. */
  quotes: QuoteBlock[];
};

/** Retire les préfixes `>` à tous les niveaux (`> > > x` → `x`). */
function unquoteAllLevels(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^(\s?>\s?)+/, ""))
    .join("\n");
}

/**
 * Trouve la position du premier marqueur de quote (texte OU ligne
 * préfixée `>`). Retourne null si aucun.
 */
function findFirstQuoteIndex(
  text: string,
): { index: number; matchLen: number; header: string } | null {
  let bestIndex = -1;
  let bestLen = 0;
  let bestHeader = "";

  for (const rx of QUOTE_MARKERS) {
    const m = rx.exec(text);
    if (m && m.index >= 0 && (bestIndex === -1 || m.index < bestIndex)) {
      bestIndex = m.index;
      bestLen = m[0].length;
      bestHeader = m[0].trim();
    }
  }

  // Lignes préfixées `>` — souvent la seule marque d'un quote quand
  // l'expéditeur a supprimé l'attribution "X wrote:".
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s?>/.test(line) && (bestIndex === -1 || offset < bestIndex)) {
      bestIndex = offset;
      bestLen = 0;
      bestHeader = "";
      break;
    }
    offset += line.length + 1;
  }

  if (bestIndex === -1) return null;
  return { index: bestIndex, matchLen: bestLen, header: bestHeader };
}

/**
 * Retire la signature texte finale (après `-- \n` selon RFC 3676).
 * Best-effort : si le séparateur n'est pas standard on ne touche pas.
 */
function stripSignature(text: string): string {
  const idx = text.search(/\n-- \n/);
  if (idx === -1) return text;
  return text.slice(0, idx).trimEnd();
}

/** Strip très basique de tags HTML pour obtenir du texte parseur-compatible. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Retire les blockquote/divs gmail_quote et gmail_attr du HTML.
 * Regex plutôt qu'un DOM parseur pour rester léger côté serveur —
 * le HTML Gmail est bien structuré, ça suffit.
 */
function stripGmailQuotesFromHtml(html: string): string {
  return html
    .replace(/<blockquote[^>]*class="[^"]*gmail_quote[^"]*"[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<div[^>]*class="[^"]*gmail_quote_container[^"]*"[\s\S]*?<\/div>/gi, "")
    .replace(/<div[^>]*class="[^"]*gmail_attr[^"]*"[\s\S]*?<\/div>/gi, "");
}

/**
 * Parse un message email en corps propre + historique du fil.
 *
 * @example
 *   parseEmailThread({
 *     bodyText: "Ok merci.\n\nLe 15 mars 2026, X a écrit :\n> Voici mon offre.",
 *     bodyHtml: null,
 *   })
 *   // → { cleanText: "Ok merci.",
 *   //     cleanHtml: null,
 *   //     quotes: [{ header: "Le 15 mars 2026, X a écrit :", body: "Voici mon offre." }] }
 */
export function parseEmailThread(input: {
  bodyText: string | null | undefined;
  bodyHtml: string | null | undefined;
}): ParsedThread {
  const rawText = input.bodyText ?? (input.bodyHtml ? htmlToText(input.bodyHtml) : "");
  const stripped = stripSignature(rawText);
  const cleanHtml = input.bodyHtml ? stripGmailQuotesFromHtml(input.bodyHtml).trim() : null;

  const found = findFirstQuoteIndex(stripped);
  if (!found) {
    return { cleanText: stripped.trim(), cleanHtml, quotes: [] };
  }

  const cleanText = stripped.slice(0, found.index).trim();
  const rest = stripped.slice(found.index + found.matchLen).replace(/^\n/, "");
  const historyBody = unquoteAllLevels(rest).trim();

  const quotes: QuoteBlock[] = historyBody
    ? [{ header: found.header || null, body: historyBody }]
    : [];

  return { cleanText, cleanHtml, quotes };
}
