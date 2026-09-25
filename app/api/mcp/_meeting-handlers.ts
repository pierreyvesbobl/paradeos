import { eq } from "drizzle-orm";
import { z } from "zod";
import { meetingProposals, meetings } from "../../../db/schema/meetings";
import { db } from "../../../lib/db/server";
import { extractAndSaveProposals } from "../../../lib/meetings/extract-and-save";

/**
 * Extraction LLM d'une réunion, exposée en MCP. Vit ici et pas dans
 * `mcp-server/tools.ts` parce qu'elle tire tout le pipeline Next
 * (`server-only`, SDK ai, réglages modèle) : le transport stdio ne sait
 * pas le charger. Le tool n'est donc servi que par la route HTTP.
 *
 * Coût : plusieurs dizaines de secondes, jusqu'à 4 min sur un gros
 * transcript (cf. `LLM_BUDGET_MS.meetingExtraction`) — d'où le
 * `maxDuration` relevé sur la route.
 */
export const extractMeetingMcpSchema = z.object({
  id: z.string().uuid(),
  /**
   * Les propositions déjà décidées (acceptées / rejetées) sont perdues :
   * l'extraction repart de zéro. Requis si la réunion a déjà été extraite.
   */
  confirmed: z.boolean().optional(),
});

export async function extractMeetingMcp(args: z.infer<typeof extractMeetingMcpSchema>) {
  const conn = await db();
  const [meeting] = await conn
    .select({ id: meetings.id, title: meetings.title, status: meetings.status })
    .from(meetings)
    .where(eq(meetings.id, args.id))
    .limit(1);
  if (!meeting) throw new Error("Meeting introuvable.");

  if (meeting.status !== "ingested" && args.confirmed !== true) {
    throw new Error(
      `« ${meeting.title} » a déjà été extraite (statut "${meeting.status}") : ré-extraire supprime les propositions déjà décidées. Demande confirmation, puis confirmed=true.`,
    );
  }

  await extractAndSaveProposals(meeting.id);

  const [after] = await conn
    .select({ summary: meetings.summary, status: meetings.status, occurredAt: meetings.occurredAt })
    .from(meetings)
    .where(eq(meetings.id, meeting.id))
    .limit(1);

  const proposals = await conn
    .select({ id: meetingProposals.id, kind: meetingProposals.kind })
    .from(meetingProposals)
    .where(eq(meetingProposals.meetingId, meeting.id));

  const byKind: Record<string, number> = {};
  for (const p of proposals) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;

  return {
    id: meeting.id,
    title: meeting.title,
    status: after?.status ?? "extracted",
    occurredAt: after?.occurredAt ?? null,
    summary: after?.summary ?? null,
    proposalCount: proposals.length,
    proposalsByKind: byKind,
    nextStep:
      "Les propositions restent à valider dans Paradeos (fiche réunion) — `get_meeting` en donne le détail.",
  };
}
