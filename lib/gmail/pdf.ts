import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

/**
 * Extrait le texte d'un PDF. Retourne un string concaténé (pages
 * séparées par "\n\n"). Limite à 30k chars pour ne pas exploser le
 * prompt LLM en aval.
 */
export async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const { text } = await extractText(pdf, { mergePages: true });
  const merged = Array.isArray(text) ? text.join("\n\n") : text;
  if (typeof merged !== "string") return "";
  if (merged.length > 30_000) return `${merged.slice(0, 30_000)}\n\n[…tronqué]`;
  return merged;
}
