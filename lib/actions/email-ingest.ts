"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/actions/action";
import { requireAdmin } from "@/lib/auth/admin";
import { getOrCreateGmailLabel, loadGmailLabelCache } from "@/lib/gmail/links";
import { getValidAccessToken } from "@/lib/google/account";
import { ingestEmailTranscripts } from "@/lib/meetings/ingest-from-email";
import {
  updateMeetingsEmailAddressSchema,
  updateMeetingsEmailLabelSchema,
} from "@/lib/schemas/email-ingest";
import { SETTING_KEYS, setSetting } from "@/lib/settings";

/**
 * Enregistre le label surveillé et le crée dans Gmail s'il n'existe pas
 * encore : sans le label, l'utilisateur n'a nulle part où ranger ses
 * mails, et le filtre Gmail qu'il va écrire ne pourrait pas le viser.
 */
export const updateMeetingsEmailLabel = action(
  updateMeetingsEmailLabelSchema,
  async ({ input, user }) => {
    await requireAdmin(user);

    if (input.label === "") {
      await setSetting(SETTING_KEYS.MEETINGS_EMAIL_LABEL, null, user.id);
      revalidatePath("/settings/integrations");
      return { ok: true as const, labelCreated: false };
    }

    let labelCreated = false;
    const accessToken = await getValidAccessToken(user.id);
    if (!accessToken) {
      throw new Error("Compte Google non connecté — connecte-le avant d'activer l'ingestion.");
    }
    const cache = await loadGmailLabelCache(accessToken);
    if (!cache.has(input.label)) {
      await getOrCreateGmailLabel(accessToken, input.label, cache);
      labelCreated = true;
    }

    await setSetting(SETTING_KEYS.MEETINGS_EMAIL_LABEL, input.label, user.id);
    revalidatePath("/settings/integrations");
    return { ok: true as const, labelCreated };
  },
);

/**
 * Enregistre l'adresse dédiée. Rien à créer côté Google ici : l'alias
 * ou le groupe se pose dans la console Workspace, Parade OS se contente
 * de chercher les mails qui en viennent.
 */
export const updateMeetingsEmailAddress = action(
  updateMeetingsEmailAddressSchema,
  async ({ input, user }) => {
    await requireAdmin(user);
    await setSetting(
      SETTING_KEYS.MEETINGS_EMAIL_ADDRESS,
      input.address === "" ? null : input.address.toLowerCase(),
      user.id,
    );
    revalidatePath("/settings/integrations");
    return { ok: true as const };
  },
);

/**
 * Déclenche manuellement l'ingestion depuis l'UI (bouton « Sync now »).
 * Le cron 30 min fait le même boulot en automatique.
 */
export const syncEmailTranscriptsNow = action(z.object({}), async ({ user }) => {
  await requireAdmin(user);
  const result = await ingestEmailTranscripts();
  revalidatePath("/meetings");
  revalidatePath("/settings/integrations");
  return result;
});
