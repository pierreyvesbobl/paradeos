"use server";

import { gmailSyncState } from "@/db/schema/gmail";
import { googleAccounts } from "@/db/schema/google-accounts";
import { users } from "@/db/schema/users";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { manualLinkThread, rebuildAllAutoLinks, unlinkThread } from "@/lib/gmail/link";
import { purgeGmailData, syncIncremental } from "@/lib/gmail/sync";
import { hasRequiredGmailScopes } from "@/lib/google/oauth";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Trouve un user admin avec compte Google connecté ET scope gmail.
 * La sync est mono-tenant en pratique — on impersonate l'admin.
 */
async function getGmailUserId(): Promise<string | null> {
  const conn = await db();
  const rows = await conn
    .select({ id: users.id, scopes: googleAccounts.scopes })
    .from(users)
    .innerJoin(googleAccounts, eq(googleAccounts.userId, users.id))
    .where(eq(users.role, "admin"));
  for (const r of rows) {
    if (hasRequiredGmailScopes(r.scopes)) return r.id;
  }
  return null;
}

/**
 * Déclenche un run de sync à la demande (bouton "Sync now"). Idempotent
 * — peut être appelé plusieurs fois pour drainer le bootstrap.
 */
export const triggerGmailSync = action(z.object({}), async ({ user }) => {
  const targetUserId = (await getGmailUserId()) ?? user.id;
  const result = await syncIncremental(targetUserId);
  revalidatePath("/emails");
  revalidatePath("/settings/integrations");
  return {
    mode: result.mode,
    inserted: result.inserted,
    bodiesFetched: result.bodiesFetched,
    hasMore: result.hasMore,
    errors: result.errors,
  };
});

export const linkThreadToSubject = action(
  z.object({
    threadId: z.string().uuid(),
    linkKind: z.enum(["project", "contact", "entity"]),
    linkId: z.string().uuid(),
  }),
  async ({ input, user }) => {
    await manualLinkThread({ ...input, createdBy: user.id });
    revalidatePath("/emails");
    revalidatePath(`/emails/${input.threadId}`);
    if (input.linkKind === "project") revalidatePath(`/projets/${input.linkId}`);
    if (input.linkKind === "contact") revalidatePath(`/contacts/${input.linkId}`);
    if (input.linkKind === "entity") revalidatePath(`/entites/${input.linkId}`);
    return { ok: true as const };
  },
);

export const unlinkThreadFromSubject = action(
  z.object({
    threadId: z.string().uuid(),
    linkKind: z.enum(["project", "contact", "entity"]),
    linkId: z.string().uuid(),
  }),
  async ({ input }) => {
    await unlinkThread(input);
    revalidatePath("/emails");
    revalidatePath(`/emails/${input.threadId}`);
    if (input.linkKind === "project") revalidatePath(`/projets/${input.linkId}`);
    if (input.linkKind === "contact") revalidatePath(`/contacts/${input.linkId}`);
    if (input.linkKind === "entity") revalidatePath(`/entites/${input.linkId}`);
    return { ok: true as const };
  },
);

/**
 * Re-run l'auto-linking sur tous les threads. Utile après un import de
 * contacts ou un changement de website d'entité.
 */
export const rebuildAutoLinks = action(z.object({}), async ({ user }) => {
  const targetUserId = (await getGmailUserId()) ?? user.id;
  const n = await rebuildAllAutoLinks(targetUserId);
  revalidatePath("/emails");
  return { rebuilt: n };
});

/**
 * Purge totale des données Gmail locales pour l'admin Gmail (ou le user
 * courant en fallback). Le prochain sync repartira en bootstrap.
 */
export const purgeLocalGmail = action(z.object({}), async ({ user }) => {
  const targetUserId = (await getGmailUserId()) ?? user.id;
  await purgeGmailData(targetUserId);
  // S'assure que la ligne sync_state est aussi reset.
  const conn = await db();
  await conn.delete(gmailSyncState).where(eq(gmailSyncState.userId, targetUserId));
  revalidatePath("/emails");
  revalidatePath("/settings/integrations");
  return { ok: true as const };
});
