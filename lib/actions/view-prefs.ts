"use server";

import { action } from "@/lib/actions/action";
import { setViewPref } from "@/lib/db/queries/view-prefs";
import { z } from "zod";

const PAGE_KEY_RE = /^[a-z0-9/_-]{1,64}$/;

const saveViewPrefSchema = z.object({
  pageKey: z.string().regex(PAGE_KEY_RE, "page_key invalide"),
  /** Querystring sans le `?`. Limitée pour éviter tout abus. */
  params: z.string().max(2000),
});

/**
 * Persiste la querystring courante (filtres, tris, recherche) pour
 * l'utilisateur connecté. Appelée en debounce 500ms côté client.
 */
export const saveViewPref = action(saveViewPrefSchema, async ({ input, user }) => {
  await setViewPref(user.id, input.pageKey, input.params);
  return { ok: true as const };
});
