import "server-only";

import { appSettings } from "@/db/schema/app-settings";
import { db } from "@/lib/db/server";
import { eq } from "drizzle-orm";

export const SETTING_KEYS = {
  /**
   * Clé API OpenRouter (https://openrouter.ai). Donne accès à Claude /
   * GPT / Gemini / Llama / etc. via une API OpenAI-compatible.
   */
  OPENROUTER_API_KEY: "OPENROUTER_API_KEY",
  /**
   * Identifiant du modèle OpenRouter à utiliser, ex.
   * `anthropic/claude-sonnet-4`, `openai/gpt-4.1`, `google/gemini-2.0-flash-exp`.
   * Si non défini, fallback sur `DEFAULT_LLM_MODEL` (cf. lib/schemas/integrations.ts).
   */
  LLM_MODEL: "LLM_MODEL",
  /** @deprecated remplacé par OPENROUTER_API_KEY. Lu pour migration douce. */
  OPENAI_API_KEY: "OPENAI_API_KEY",
  /**
   * ID du dossier Google Drive surveillé pour ingestion automatique
   * des transcripts de meeting. Le cron (cf. /api/cron/ingest-drive-transcripts)
   * liste ce dossier toutes les 30 min et ingère les nouveaux fichiers
   * (Google Docs ou texte) → meeting + extraction LLM auto.
   */
  MEETINGS_DRIVE_FOLDER_ID: "MEETINGS_DRIVE_FOLDER_ID",
  /**
   * Kill switch coût : si "false", l'extraction LLM des emails est
   * désactivée (le sync continue mais ne traite pas les pending).
   * Default : enabled. À mettre à "false" si le coût LLM explose.
   */
  GMAIL_EXTRACTION_ENABLED: "GMAIL_EXTRACTION_ENABLED",
  /**
   * ID du dossier Drive racine où l'agent classe les factures d'achat.
   * Sous ce dossier, l'agent crée la hiérarchie <year>/<supplier>/.
   * Sans cette valeur, le classement est désactivé.
   */
  INVOICE_FILING_ROOT_FOLDER_ID: "INVOICE_FILING_ROOT_FOLDER_ID",
  /**
   * Kill switch : si "false", on n'auto-file plus les factures détectées
   * (les rows pending restent en attente). Default : enabled.
   */
  INVOICE_FILING_ENABLED: "INVOICE_FILING_ENABLED",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/**
 * Lit un réglage. Utilise les credentials serveur (`db()`), donc passe
 * par les RLS si la session est non-admin → renverra `null` pour ces
 * appels. Les jobs serveurs (cron, route handlers) doivent être admin
 * ou utiliser une connexion service-role dédiée.
 *
 * Fallback sur `process.env[key]` si rien en base, pour cohabiter avec
 * une config injectée par Vercel.
 */
export async function getSetting(key: SettingKey): Promise<string | null> {
  const conn = await db();
  const [row] = await conn
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  if (row?.value && row.value.length > 0) return row.value;
  const fromEnv = process.env[key];
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

/**
 * Upsert d'un réglage. Doit être appelé après `requireAdmin`.
 * Une `value` vide ou `null` supprime l'entrée (retombe sur env vars).
 */
export async function setSetting(
  key: SettingKey,
  value: string | null,
  updatedBy: string,
): Promise<void> {
  const conn = await db();
  if (!value || value.trim() === "") {
    await conn.delete(appSettings).where(eq(appSettings.key, key));
    return;
  }
  await conn
    .insert(appSettings)
    .values({ key, value: value.trim(), updatedBy })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: value.trim(), updatedBy, updatedAt: new Date() },
    });
}

/** Renvoie un statut "défini / non défini" sans révéler la valeur. */
export async function getSettingStatus(
  key: SettingKey,
): Promise<{ set: boolean; source: "db" | "env" | null; preview: string | null }> {
  const conn = await db();
  const [row] = await conn
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  if (row?.value) return { set: true, source: "db", preview: maskKey(row.value) };
  const env = process.env[key];
  if (env && env.length > 0) return { set: true, source: "env", preview: maskKey(env) };
  return { set: false, source: null, preview: null };
}

function maskKey(s: string): string {
  if (s.length <= 8) return "•".repeat(s.length);
  return `${s.slice(0, 3)}…${s.slice(-4)}`;
}
