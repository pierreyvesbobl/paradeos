"use server";

import { action } from "@/lib/actions/action";
import { requireAdmin } from "@/lib/auth/admin";
import { uploadDougsInvoicingLogo } from "@/lib/dougs/client";
import { updateLlmConfigSchema, updateOpenAiKeySchema } from "@/lib/schemas/integrations";
import { SETTING_KEYS, setSetting } from "@/lib/settings";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Met à jour la config LLM globale (clé OpenRouter + modèle).
 * Vide une valeur = chaîne vide → setting supprimé (retombe sur env
 * vars / defaults).
 */
export const updateLlmConfig = action(updateLlmConfigSchema, async ({ input, user }) => {
  await requireAdmin(user);
  // `undefined` = ne pas toucher. `""` = supprimer. Sinon = set.
  if (input.apiKey !== undefined) {
    await setSetting(
      SETTING_KEYS.OPENROUTER_API_KEY,
      input.apiKey === "" ? null : input.apiKey,
      user.id,
    );
  }
  if (input.model !== undefined) {
    await setSetting(SETTING_KEYS.LLM_MODEL, input.model === "" ? null : input.model, user.id);
  }
  revalidatePath("/settings/integrations");
  return { ok: true as const };
});

/**
 * Met à jour la clé OpenAI directe utilisée pour la transcription
 * audio Whisper (cf. lib/meetings/transcribe.ts). `""` = supprimer.
 */
export const updateOpenAiKey = action(updateOpenAiKeySchema, async ({ input, user }) => {
  await requireAdmin(user);
  await setSetting(SETTING_KEYS.OPENAI_API_KEY, input.apiKey === "" ? null : input.apiKey, user.id);
  revalidatePath("/settings/integrations");
  return { ok: true as const };
});

/**
 * Enregistre le logo de facturation d'une marque.
 *
 * Le fichier est téléversé chez Dougs (seul endroit où `logoUuid` a du sens) et
 * seul l'UUID est conservé en base. On ne stocke pas l'image côté Parade OS :
 * elle n'y servirait à rien et il faudrait la garder synchronisée.
 *
 * L'image arrive en base64 plutôt qu'en FormData : un logo pèse quelques dizaines
 * de kilo-octets, et ça évite une route dédiée juste pour un réglage.
 */
export const setBrandLogo = action(
  z.object({
    brand: z.enum(["coworking", "automato", "parade"]),
    filename: z.string().trim().min(1).max(200),
    contentType: z
      .string()
      .trim()
      .regex(/^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/, {
        message: "Format accepté : PNG, JPEG, GIF, WebP ou SVG.",
      }),
    dataBase64: z.string().min(1).max(4_000_000),
  }),
  async ({ input, user }) => {
    await requireAdmin(user);

    const content = Buffer.from(input.dataBase64, "base64");
    if (content.byteLength === 0) throw new Error("Fichier vide.");
    if (content.byteLength > 2_000_000) {
      throw new Error("Logo trop lourd : 2 Mo maximum.");
    }

    const { uuid } = await uploadDougsInvoicingLogo(user.id, {
      filename: input.filename,
      content,
      contentType: input.contentType,
    });

    const key =
      input.brand === "coworking"
        ? SETTING_KEYS.BRAND_LOGO_COWORKING
        : input.brand === "automato"
          ? SETTING_KEYS.BRAND_LOGO_AUTOMATO
          : SETTING_KEYS.BRAND_LOGO_PARADE;
    await setSetting(key, uuid, user.id);

    revalidatePath("/settings/integrations");
    return { ok: true as const, uuid };
  },
);

/**
 * Dossier Drive où atterrissent les PDF des factures de vente.
 *
 * Accepte une URL Drive ou un id brut : on colle ce qu'on a sous la main.
 * Vider le champ désactive le classement sans rien casser — l'envoi au client
 * n'en dépend pas.
 */
export const setSalesInvoiceDriveFolder = action(
  z.object({ folderIdOrUrl: z.string().trim().max(500) }),
  async ({ input, user }) => {
    await requireAdmin(user);
    const raw = input.folderIdOrUrl;
    if (!raw) {
      await setSetting(SETTING_KEYS.SALES_INVOICE_DRIVE_FOLDER_ID, null, user.id);
      revalidatePath("/settings/integrations");
      return { ok: true as const, folderId: null };
    }
    const folderId = raw.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] ?? raw;
    if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) {
      throw new Error("Identifiant de dossier Drive invalide.");
    }
    await setSetting(SETTING_KEYS.SALES_INVOICE_DRIVE_FOLDER_ID, folderId, user.id);
    revalidatePath("/settings/integrations");
    return { ok: true as const, folderId };
  },
);
