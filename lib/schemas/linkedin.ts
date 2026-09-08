import { z } from "zod";

/**
 * Contrat entre l'extension Chrome et POST /api/linkedin/ingest.
 *
 * L'extension fait le travail de reverse de Voyager et n'envoie que du
 * JSON déjà normalisé : côté serveur on ne connaît rien des formes de
 * réponse LinkedIn, ce qui isole Paradeos de leurs changements. Toute
 * évolution du parsing se règle en mettant l'extension à jour.
 *
 * Les bornes sont volontairement serrées : cet endpoint est ouvert en
 * CORS et authentifié par un simple Bearer, il ne doit jamais servir de
 * canal d'écriture massive.
 */

/** Un envoi = un lot. L'extension découpe elle-même. */
export const MAX_ITEMS_PER_BATCH = 100;

const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}/))
  .nullable()
  .optional();

const participantSchema = z.object({
  urn: z.string().trim().min(1).max(300),
  name: z.string().trim().max(300).nullable().optional(),
  headline: z.string().trim().max(500).nullable().optional(),
  publicIdentifier: z.string().trim().max(200).nullable().optional(),
  pictureUrl: z.string().trim().max(1000).nullable().optional(),
});

const messageSchema = z.object({
  messageUrn: z.string().trim().min(1).max(300),
  senderUrn: z.string().trim().max(300).nullable().optional(),
  senderName: z.string().trim().max(300).nullable().optional(),
  senderPublicIdentifier: z.string().trim().max(200).nullable().optional(),
  direction: z.enum(["in", "out"]).default("in"),
  /** Borné : un DM LinkedIn ne dépasse pas quelques milliers de caractères. */
  bodyText: z.string().max(20000).nullable().optional(),
  sentAt: isoDate,
});

export const conversationSchema = z.object({
  conversationUrn: z.string().trim().min(1).max(300),
  title: z.string().trim().max(500).nullable().optional(),
  isGroup: z.boolean().default(false),
  participants: z.array(participantSchema).max(50).default([]),
  messages: z.array(messageSchema).max(200).default([]),
});

export const connectionSchema = z.object({
  memberUrn: z.string().trim().min(1).max(300),
  publicIdentifier: z.string().trim().max(200).nullable().optional(),
  firstName: z.string().trim().max(200).default(""),
  lastName: z.string().trim().max(200).default(""),
  headline: z.string().trim().max(500).nullable().optional(),
  company: z.string().trim().max(300).nullable().optional(),
  position: z.string().trim().max(300).nullable().optional(),
  profileUrl: z.string().trim().max(1000).nullable().optional(),
  email: z.string().trim().email().max(320).nullable().optional(),
  connectedAt: isoDate,
});

export const ingestPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("conversations"),
    items: z.array(conversationSchema).min(1).max(MAX_ITEMS_PER_BATCH),
  }),
  z.object({
    kind: z.literal("connections"),
    items: z.array(connectionSchema).min(1).max(MAX_ITEMS_PER_BATCH),
  }),
]);

export type IngestPayload = z.infer<typeof ingestPayloadSchema>;
export type IngestConversation = z.infer<typeof conversationSchema>;
export type IngestConnection = z.infer<typeof connectionSchema>;
