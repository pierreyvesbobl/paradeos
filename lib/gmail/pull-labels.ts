import "server-only";

import { gmailTags, gmailThreadTags, gmailThreads } from "@/db/schema/gmail";
import { db } from "@/lib/db/server";
import { getValidAccessToken } from "@/lib/google/account";
import { getThread, listThreadsByLabel } from "@/lib/google/gmail-api";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { SKIP_LABELS, upsertThreadAndMessage } from "./sync";

/**
 * Rapatrie les mails rangés à la main dans Gmail sous un label
 * `Paradeos/Projets/…` ou `Paradeos/Entités/…`.
 *
 * Pourquoi ça ne peut pas passer par le sync : `syncIncremental` ne lit
 * les labels que des threads qu'il a touchés, c'est-à-dire ceux ayant
 * reçu un message pendant la fenêtre de sync. Un vieux fil dormant qu'on
 * tague dans Gmail n'est donc jamais vu. Ici on part du label et on
 * remonte aux threads (`threads.list?labelIds=`), ce qui voit tout
 * l'historique, sans limite d'âge.
 *
 * Deux cas traités :
 *   - thread déjà en base → il ne manque que la liaison ;
 *   - thread absent (antérieur à la fenêtre d'import, ou jamais ingéré)
 *     → import des métadonnées du thread, puis liaison.
 *
 * Les messages sont importés en `skipped` : on veut le fil visible et
 * rattaché, pas déclencher une extraction LLM rétroactive sur des mois
 * d'archives. Le sync remettra un message en `pending` de lui-même s'il
 * matche le CRM et qu'un nouveau message arrive.
 *
 * Idempotent. Une liaison invalidée à la main n'est jamais ressuscitée :
 * l'insert bute sur la ligne `dismissed` qui scelle le refus.
 */
export type PullLabelsResult = {
  labelsScanned: number;
  threadsSeen: number;
  linksCreated: number;
  threadsImported: number;
  errors: string[];
};

/** Garde-fou : un label très utilisé ne doit pas faire exploser le run. */
const MAX_THREADS_PER_LABEL = 300;
const PAGE_SIZE = 100;

export async function pullLabeledThreadsFromGmail(userId: string): Promise<PullLabelsResult> {
  const result: PullLabelsResult = {
    labelsScanned: 0,
    threadsSeen: 0,
    linksCreated: 0,
    threadsImported: 0,
    errors: [],
  };

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    result.errors.push("Compte Google non connecté.");
    return result;
  }

  const conn = await db();
  // Seuls les rattachements CRM ont un sens ici. Les libellés système
  // (sens de facture) sont posés par le détecteur, pas rangés à la main.
  const labels = await conn
    .select({
      id: gmailTags.id,
      labelName: gmailTags.labelName,
      gmailLabelId: gmailTags.gmailLabelId,
    })
    .from(gmailTags)
    .where(
      and(
        eq(gmailTags.userId, userId),
        isNotNull(gmailTags.gmailLabelId),
        inArray(gmailTags.kind, ["project", "entity"]),
      ),
    );

  for (const label of labels) {
    if (!label.gmailLabelId) continue;
    result.labelsScanned++;

    // 1. Tous les threads Gmail portant ce label.
    const gmailThreadIds: string[] = [];
    let pageToken: string | undefined;
    try {
      do {
        const page = await listThreadsByLabel(accessToken, label.gmailLabelId, {
          pageToken,
          maxResults: PAGE_SIZE,
        });
        for (const t of page.threads ?? []) gmailThreadIds.push(t.id);
        pageToken = page.nextPageToken;
      } while (pageToken && gmailThreadIds.length < MAX_THREADS_PER_LABEL);
    } catch (err) {
      result.errors.push(
        `${label.labelName} — listing : ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (gmailThreadIds.length === 0) continue;
    result.threadsSeen += gmailThreadIds.length;

    // 2. Ceux qu'on connaît déjà localement.
    const known = await conn
      .select({ id: gmailThreads.id, gmailThreadId: gmailThreads.gmailThreadId })
      .from(gmailThreads)
      .where(
        and(eq(gmailThreads.userId, userId), inArray(gmailThreads.gmailThreadId, gmailThreadIds)),
      );
    const localIdByGmailId = new Map(known.map((t) => [t.gmailThreadId, t.id]));

    // 3. Import des manquants (métadonnées seulement).
    for (const gmailThreadId of gmailThreadIds) {
      if (localIdByGmailId.has(gmailThreadId)) continue;
      try {
        const thread = await getThread(accessToken, gmailThreadId, "metadata");
        let localId: string | null = null;
        for (const message of thread.messages ?? []) {
          if ((message.labelIds ?? []).some((l) => SKIP_LABELS.has(l))) continue;
          const { threadIdLocal } = await upsertThreadAndMessage(userId, message, null, "skipped");
          localId = threadIdLocal;
        }
        if (localId) {
          localIdByGmailId.set(gmailThreadId, localId);
          result.threadsImported++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 404 = thread supprimé côté Gmail entre le listing et le get.
        if (msg.includes("404") || msg.includes("notFound")) continue;
        result.errors.push(`thread ${gmailThreadId} : ${msg}`);
      }
    }

    // 4. Liaisons manquantes. `source: "gmail"` — c'est bien une décision
    //    humaine, prise dans Gmail plutôt que dans Paradeos.
    const localIds = [...localIdByGmailId.values()];
    if (localIds.length === 0) continue;
    const inserted = await conn
      .insert(gmailThreadTags)
      .values(localIds.map((threadId) => ({ threadId, tagId: label.id, source: "gmail" })))
      .onConflictDoNothing()
      .returning({ id: gmailThreadTags.id });
    result.linksCreated += inserted.length;
  }

  return result;
}
