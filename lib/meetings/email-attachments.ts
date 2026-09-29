/**
 * Règles pures de l'ingestion d'une réunion reçue par mail : quelle
 * pièce jointe porte le transcript, comment titrer la réunion, et
 * comment nettoyer un corps de mail pour qu'il serve de transcript.
 * Pas d'API Gmail ni de DB ici — `ingest-from-email.ts` fait la
 * plomberie.
 */

export type EmailAttachmentMeta = {
  filename: string;
  mimeType: string;
  size: number;
};

/**
 * Nature d'une PJ du point de vue du pipeline :
 *  - `text`  : transcript déjà écrit (.txt, .md, .vtt, .srt)
 *  - `pdf`   : transcript exporté en PDF → texte extrait via unpdf
 *  - `audio` : enregistrement brut → Whisper
 */
export type TranscriptSourceKind = "text" | "pdf" | "audio";

const TEXT_EXTENSIONS = new Set(["txt", "text", "md", "markdown", "vtt", "srt", "rtf"]);

/**
 * Extensions acceptées par l'API de transcription OpenAI. Un `.wma` ou
 * un `.amr` est bien de l'audio mais serait refusé par Whisper : autant
 * le compter comme non supporté tout de suite plutôt que de payer un
 * upload pour rien.
 */
const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "m4a",
  "mp4",
  "mpeg",
  "mpga",
  "wav",
  "webm",
  "ogg",
  "oga",
  "flac",
]);

/** Plafond de l'API de transcription OpenAI (25 Mo). */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** En dessous, une PJ texte n'est pas un transcript (accusé, signature…). */
export const MIN_TRANSCRIPT_CHARS = 50;

/**
 * Le corps d'un mail est bavard par nature (« voilà le compte-rendu »).
 * On exige plus de matière que pour une PJ avant de le traiter comme un
 * transcript, sinon chaque mail transféré vide créerait une réunion.
 */
export const MIN_BODY_CHARS = 400;

export function fileExtension(filename: string): string | null {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Classe une PJ. Le type MIME annoncé par le client mail est peu fiable
 * (un `.m4a` arrive souvent en `application/octet-stream`), donc
 * l'extension décide en premier et le MIME ne sert que de filet.
 */
export function classifyEmailAttachment(att: EmailAttachmentMeta): TranscriptSourceKind | null {
  const ext = fileExtension(att.filename);
  if (ext && TEXT_EXTENSIONS.has(ext)) return "text";
  if (ext === "pdf") return "pdf";
  if (ext && AUDIO_EXTENSIONS.has(ext)) return "audio";

  const mime = att.mimeType.toLowerCase();
  if (mime.startsWith("text/")) return "text";
  if (mime === "application/pdf") return "pdf";
  // `video/mp4` couvre les captures d'écran de visio, que Whisper avale.
  if (mime.startsWith("audio/") || mime === "video/mp4" || mime === "video/webm") return "audio";
  return null;
}

export type TranscriptSource = {
  kind: TranscriptSourceKind;
  attachment: EmailAttachmentMeta;
};

/**
 * Choisit la PJ qui portera le transcript. L'ordre est celui du coût :
 * un texte déjà écrit passe avant un PDF à parser, qui passe avant un
 * audio à transcrire (Whisper est payant et lent). À nature égale, la
 * plus grosse gagne — c'est le transcript complet plutôt qu'un extrait.
 */
export function pickTranscriptSource(attachments: EmailAttachmentMeta[]): TranscriptSource | null {
  const priority: Record<TranscriptSourceKind, number> = { text: 0, pdf: 1, audio: 2 };
  let best: TranscriptSource | null = null;
  for (const attachment of attachments) {
    const kind = classifyEmailAttachment(attachment);
    if (!kind) continue;
    if (
      !best ||
      priority[kind] < priority[best.kind] ||
      (priority[kind] === priority[best.kind] && attachment.size > best.attachment.size)
    ) {
      best = { kind, attachment };
    }
  }
  return best;
}

const SUBJECT_PREFIX = /^\s*(re|ref|rép|rep|fw|fwd|tr|transf)\s*(\[\d+\])?\s*:\s*/i;

/**
 * Titre de la réunion depuis l'objet du mail : on retire les préfixes
 * de réponse / transfert empilés par les clients mail (`TR: Fwd: Re:`),
 * qui n'apportent rien au titre d'une réunion.
 */
export function titleFromSubject(subject: string | null, fallback: string): string {
  let value = (subject ?? "").replace(/\s+/g, " ").trim();
  // Boucle bornée : un objet peut empiler plusieurs préfixes.
  for (let i = 0; i < 5 && SUBJECT_PREFIX.test(value); i++) {
    value = value.replace(SUBJECT_PREFIX, "").trim();
  }
  if (value.length === 0) return fallback;
  return value.slice(0, 200);
}

const FORWARD_SEPARATOR = /^\s*-{2,}\s*(message transféré|forwarded message)\s*-{2,}\s*$/i;
const HEADER_LINE =
  /^\s*(de|from|à|a|to|cc|cci|bcc|objet|subject|date|envoyé|envoyé le|sent|répondre à|reply-to)\s*:/i;
const REPLY_TRAILER = /^\s*(le .+ a écrit\s*:|on .+ wrote\s*:|>+.*)$/i;
const SIGNATURE_DELIMITER = /^--\s?$/;

/**
 * Transforme le corps texte d'un mail en transcript exploitable :
 * retire l'entête de transfert, les lignes citées, la signature et le
 * bloc « Le … a écrit : ». Ce qui reste est le texte que l'expéditeur a
 * réellement collé.
 *
 * Volontairement conservateur : en cas de doute on garde la ligne. Une
 * ligne parasite coûte quelques tokens à l'extraction, une ligne de
 * transcript perdue coûte une décision.
 */
export function cleanEmailBodyForTranscript(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  let inForwardHeader = false;

  for (const line of lines) {
    if (SIGNATURE_DELIMITER.test(line)) break;
    if (REPLY_TRAILER.test(line)) {
      // Tout ce qui suit est la conversation citée, pas le transcript.
      if (/^\s*>+/.test(line)) continue;
      break;
    }
    if (FORWARD_SEPARATOR.test(line)) {
      inForwardHeader = true;
      continue;
    }
    if (inForwardHeader) {
      if (HEADER_LINE.test(line)) continue;
      if (line.trim() === "") continue;
      inForwardHeader = false;
    }
    kept.push(line);
  }

  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Retire de `html` les balises pour en tirer un texte de secours. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Nom de fichier sûr pour le Storage (miroir de `lib/actions/meeting-audio.ts`). */
export function sanitizeAudioFileName(name: string): string {
  const safe = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 200);
  // Un nom fait uniquement de séparateurs se réduit à "_" ou "." : sans
  // un caractère signifiant, le chemin Storage devient illisible.
  return /[a-zA-Z0-9]/.test(safe) ? safe : "audio";
}

/**
 * Fenêtre de recherche de l'adresse dédiée. Au-delà, un mail qui n'a
 * jamais été ingéré (pipeline coupé, clé LLM absente…) est considéré
 * comme perdu : il reste rattrapable à la main avec le label.
 */
export const ADDRESS_QUERY_WINDOW_DAYS = 30;

/**
 * Requête Gmail des mails adressés à l'adresse dédiée. `deliveredto:`
 * attrape ce qu'un alias ou un groupe a livré dans la boîte, là où
 * `to:` ne voit que l'entête — les deux sont nécessaires, un transfert
 * automatique ne réécrivant pas forcément les destinataires.
 */
export function buildAddressQuery(address: string): string {
  const safe = address.trim().toLowerCase();
  return `{to:${safe} deliveredto:${safe} cc:${safe}} newer_than:${ADDRESS_QUERY_WINDOW_DAYS}d`;
}
