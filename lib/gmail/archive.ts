import "server-only";

import { eq, sql } from "drizzle-orm";
import { gmailMessages, gmailThreads } from "@/db/schema/gmail";
import { db } from "@/lib/db/server";
import { modifyThreadLabels } from "@/lib/google/gmail-api";

/** Libellé système Gmail de la boîte de réception. */
const INBOX_LABEL_ID = "INBOX";

/**
 * Archive un fil Gmail : le retire de la boîte de réception, sans le
 * supprimer ni toucher aux autres libellés. C'est le geste « archiver »
 * de l'interface Gmail, appliqué à tout le fil.
 *
 * Sert aux factures traitées : une fois la pièce classée dans le Drive,
 * le mail n'a plus rien à faire dans l'inbox. Le miroir local des
 * libellés est mis à jour dans la foulée pour ne pas attendre le sync.
 */
export async function archiveThread(args: {
  accessToken: string;
  /** Identifiant local (`gmail_threads.id`). */
  threadIdLocal: string;
}): Promise<{ archived: boolean }> {
  const conn = await db();
  const [thread] = await conn
    .select({ id: gmailThreads.id, gmailThreadId: gmailThreads.gmailThreadId })
    .from(gmailThreads)
    .where(eq(gmailThreads.id, args.threadIdLocal))
    .limit(1);
  if (!thread) return { archived: false };

  await modifyThreadLabels(args.accessToken, thread.gmailThreadId, {
    removeLabelIds: [INBOX_LABEL_ID],
  });

  await conn
    .update(gmailThreads)
    .set({ labels: sql`array_remove(${gmailThreads.labels}, ${INBOX_LABEL_ID})` })
    .where(eq(gmailThreads.id, thread.id));
  await conn
    .update(gmailMessages)
    .set({ labels: sql`array_remove(${gmailMessages.labels}, ${INBOX_LABEL_ID})` })
    .where(eq(gmailMessages.threadId, thread.id));

  return { archived: true };
}
