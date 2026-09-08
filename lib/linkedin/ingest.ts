import "server-only";

import {
  linkedinConnections,
  linkedinConversations,
  linkedinMessages,
  linkedinSyncState,
} from "@/db/schema/linkedin";
import { db } from "@/lib/db/server";
import type { IngestConnection, IngestConversation } from "@/lib/schemas/linkedin";
import { sql } from "drizzle-orm";
import { normalizeLinkedinIdentifier } from "./identity";
import { matchPendingConnections } from "./match-connections";

/**
 * Ingestion des données poussées par l'extension Chrome.
 *
 * Reprend le pattern de `upsertThreadAndMessage` (lib/gmail/sync.ts) :
 * upsert sur les contraintes uniques, jamais de downgrade d'un contenu
 * déjà stocké, puis recalcul de l'agrégat conversation en SQL. C'est ce
 * qui rend l'import idempotent — deux runs successifs ne créent rien.
 */

export type IngestResult = {
  conversationsUpserted: number;
  messagesUpserted: number;
  connectionsUpserted: number;
  errors: string[];
};

function emptyResult(): IngestResult {
  return {
    conversationsUpserted: 0,
    messagesUpserted: 0,
    connectionsUpserted: 0,
    errors: [],
  };
}

/** Parse tolérant : une date illisible ne doit pas faire échouer un lot. */
function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function ingestConversations(
  userId: string,
  items: IngestConversation[],
): Promise<IngestResult> {
  const result = emptyResult();
  const conn = await db();

  for (const item of items) {
    try {
      // 1. Upsert conversation. `messageCount` / `lastMessageAt` /
      // `snippet` sont posés à titre indicatif puis recalculés en (3)
      // depuis les messages réellement présents.
      const [convRow] = await conn
        .insert(linkedinConversations)
        .values({
          userId,
          conversationUrn: item.conversationUrn,
          title: item.title ?? null,
          participants: item.participants.map((p) => ({
            urn: p.urn,
            name: p.name ?? null,
            headline: p.headline ?? null,
            publicIdentifier: normalizeLinkedinIdentifier(p.publicIdentifier),
            pictureUrl: p.pictureUrl ?? null,
          })),
          isGroup: item.isGroup,
          messageCount: item.messages.length,
        })
        .onConflictDoUpdate({
          target: [linkedinConversations.userId, linkedinConversations.conversationUrn],
          set: {
            title: item.title ?? null,
            participants: item.participants.map((p) => ({
              urn: p.urn,
              name: p.name ?? null,
              headline: p.headline ?? null,
              publicIdentifier: normalizeLinkedinIdentifier(p.publicIdentifier),
              pictureUrl: p.pictureUrl ?? null,
            })),
            isGroup: item.isGroup,
            updatedAt: new Date(),
          },
        })
        .returning({ id: linkedinConversations.id });

      if (!convRow) throw new Error("Échec upsert linkedin_conversation");
      const conversationId = convRow.id;

      // 2. Upsert des messages. Le body n'est jamais dégradé vers null :
      // une resynchro qui ne remonte que les métadonnées ne doit pas
      // effacer un contenu déjà capté.
      for (const msg of item.messages) {
        const inserted = await conn
          .insert(linkedinMessages)
          .values({
            conversationId,
            userId,
            messageUrn: msg.messageUrn,
            senderUrn: msg.senderUrn ?? null,
            senderName: msg.senderName ?? null,
            senderPublicIdentifier: normalizeLinkedinIdentifier(msg.senderPublicIdentifier),
            direction: msg.direction,
            bodyText: msg.bodyText ?? null,
            sentAt: toDate(msg.sentAt),
          })
          .onConflictDoUpdate({
            target: [linkedinMessages.userId, linkedinMessages.messageUrn],
            set: {
              senderName: msg.senderName ?? null,
              ...(msg.bodyText != null ? { bodyText: msg.bodyText } : {}),
              updatedAt: new Date(),
            },
          })
          .returning({ id: linkedinMessages.id });
        if (inserted.length > 0) result.messagesUpserted += 1;
      }

      // 3. Recalcul de l'agrégat, à l'identique de gmail_threads.
      await conn.execute(sql`
        update public.linkedin_conversations lc
        set message_count = sub.cnt,
            last_message_at = sub.last_at,
            snippet = sub.last_snippet,
            updated_at = now()
        from (
          select count(*)::int as cnt,
                 max(sent_at) as last_at,
                 (select left(coalesce(body_text, ''), 200)
                    from public.linkedin_messages
                   where conversation_id = ${conversationId}
                   order by sent_at desc nulls last
                   limit 1) as last_snippet
            from public.linkedin_messages
           where conversation_id = ${conversationId}
        ) sub
        where lc.id = ${conversationId}
      `);

      result.conversationsUpserted += 1;
    } catch (err) {
      // Un item cassé ne doit pas faire perdre tout le lot.
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`${item.conversationUrn} : ${message}`);
      console.error("[linkedin ingest] conversation", item.conversationUrn, err);
    }
  }

  await touchSyncState(userId, "conversations", result.errors);
  return result;
}

/**
 * Ingestion des relations. Le rapprochement avec les contacts CRM est
 * délibérément fait dans une seconde passe (`match-connections`) : ici
 * on ne fait que stocker fidèlement ce que LinkedIn expose, pour que
 * l'import reste rejouable sans reprendre les décisions déjà prises.
 */
export async function ingestConnections(
  userId: string,
  items: IngestConnection[],
): Promise<IngestResult> {
  const result = emptyResult();
  const conn = await db();

  for (const item of items) {
    try {
      await conn
        .insert(linkedinConnections)
        .values({
          userId,
          memberUrn: item.memberUrn,
          publicIdentifier: normalizeLinkedinIdentifier(item.publicIdentifier ?? item.profileUrl),
          firstName: item.firstName,
          lastName: item.lastName,
          headline: item.headline ?? null,
          company: item.company ?? null,
          position: item.position ?? null,
          profileUrl: item.profileUrl ?? null,
          email: item.email ?? null,
          connectedAt: toDate(item.connectedAt),
        })
        .onConflictDoUpdate({
          target: [linkedinConnections.userId, linkedinConnections.memberUrn],
          set: {
            // On rafraîchit ce que LinkedIn fait évoluer (poste, société),
            // mais jamais `match_status` ni `matched_contact_id` : ce sont
            // des décisions humaines, elles ne se réimportent pas.
            publicIdentifier: normalizeLinkedinIdentifier(item.publicIdentifier ?? item.profileUrl),
            firstName: item.firstName,
            lastName: item.lastName,
            headline: item.headline ?? null,
            company: item.company ?? null,
            position: item.position ?? null,
            profileUrl: item.profileUrl ?? null,
            ...(item.email != null ? { email: item.email } : {}),
            updatedAt: new Date(),
          },
        });
      result.connectionsUpserted += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`${item.memberUrn} : ${message}`);
      console.error("[linkedin ingest] connection", item.memberUrn, err);
    }
  }

  // Rapprochement CRM dans la foulée : une relation importée n'a
  // d'intérêt que rapprochée (ou explicitement mise en file). L'échec
  // du matching ne doit pas invalider une ingestion réussie.
  try {
    await matchPendingConnections(userId);
  } catch (err) {
    console.error("[linkedin ingest] matching", err);
    result.errors.push(`matching : ${err instanceof Error ? err.message : String(err)}`);
  }

  await touchSyncState(userId, "connections", result.errors);
  return result;
}

/**
 * Trace la dernière synchro pour que les réglages puissent afficher un
 * retard visible plutôt qu'un silence — c'est le seul garde-fou contre
 * une extension qui aurait cessé de tourner sans qu'on s'en aperçoive.
 */
async function touchSyncState(
  userId: string,
  kind: "conversations" | "connections",
  errors: string[],
): Promise<void> {
  const conn = await db();
  const now = new Date();
  const lastError = errors.length > 0 ? errors.slice(0, 3).join(" | ").slice(0, 500) : null;
  await conn
    .insert(linkedinSyncState)
    .values({
      userId,
      ...(kind === "conversations"
        ? { lastConversationsSyncAt: now }
        : { lastConnectionsSyncAt: now }),
      lastError,
    })
    .onConflictDoUpdate({
      target: linkedinSyncState.userId,
      set: {
        ...(kind === "conversations"
          ? { lastConversationsSyncAt: now }
          : { lastConnectionsSyncAt: now }),
        lastError,
        updatedAt: now,
      },
    });
}
