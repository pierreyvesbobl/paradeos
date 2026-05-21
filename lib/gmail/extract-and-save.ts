import "server-only";

import { emailProposals, gmailMessages, gmailTags } from "@/db/schema/gmail";
import { db } from "@/lib/db/server";
import { extractEmail } from "@/lib/gmail/extract";
import { fuzzyMatchProject } from "@/lib/meetings/extract";
import { and, eq, sql } from "drizzle-orm";

/**
 * Pipeline d'extraction email : lit le message, appelle LLM, persiste
 * les propositions. Idempotent : delete + insert.
 *
 * Statut du message :
 *   - `pending` → on tente l'extraction
 *   - succès → `extracted`
 *   - échec  → `failed` + dougs_status laissé tel quel
 */
export async function extractAndSaveEmailProposals(messageId: string): Promise<{
  count: number;
  skipped: boolean;
  reason?: string;
}> {
  const conn = await db();
  const [msg] = await conn
    .select()
    .from(gmailMessages)
    .where(eq(gmailMessages.id, messageId))
    .limit(1);
  if (!msg) return { count: 0, skipped: true, reason: "message introuvable" };

  // On a besoin d'un body pour extraire — un message en `skipped` n'a
  // pas de body stocké.
  if (!msg.bodyText && !msg.bodyHtml) {
    await conn
      .update(gmailMessages)
      .set({ extractionStatus: "failed" })
      .where(eq(gmailMessages.id, messageId));
    return { count: 0, skipped: true, reason: "pas de body" };
  }

  // Catégories existantes pour ce user → injectées dans le prompt LLM
  // pour qu'il réutilise les noms canoniques au lieu d'inventer des
  // doublons ("Comptabilité" vs "Compta").
  const existingCategoryRows = await conn
    .select({ labelName: gmailTags.labelName })
    .from(gmailTags)
    .where(and(eq(gmailTags.userId, msg.userId), eq(gmailTags.kind, "category")));
  const existingCategories = existingCategoryRows
    .map((r) => r.labelName.split("/").pop() ?? r.labelName)
    .sort();

  let result: Awaited<ReturnType<typeof extractEmail>>;
  try {
    result = await extractEmail({
      subject: msg.subject,
      fromEmail: msg.fromEmail,
      fromName: msg.fromName,
      bodyText: msg.bodyText,
      bodyHtml: msg.bodyHtml,
      existingCategories,
    });
  } catch (err) {
    await conn
      .update(gmailMessages)
      .set({ extractionStatus: "failed" })
      .where(eq(gmailMessages.id, messageId));
    throw err;
  }

  // Si du sensitive a fui malgré le sanitize, on ne persiste rien et
  // on log juste — éviter la propagation de secrets en proposition.
  if (result.sensitiveDetected) {
    await conn
      .update(gmailMessages)
      .set({ extractionStatus: "failed" })
      .where(eq(gmailMessages.id, messageId));
    return { count: 0, skipped: true, reason: "sensitive detected" };
  }

  // Wipe les anciennes propositions du message + ré-injecte.
  await conn.delete(emailProposals).where(eq(emailProposals.messageId, messageId));

  const rows: Array<{
    messageId: string;
    kind: "task" | "category_tag" | "project_link";
    payload: Record<string, unknown>;
    matchedId: string | null;
    matchConfidence: string | null;
  }> = [];

  // 1. Tâches
  for (const t of result.proposedTasks) {
    const projectMatch = t.projectName ? await fuzzyMatchProject(t.projectName) : null;
    rows.push({
      messageId,
      kind: "task",
      payload: {
        title: t.title,
        dueDate: t.dueDate,
        priority: t.priority,
        projectName: t.projectName,
        projectId: projectMatch?.id ?? null,
        assigneeName: t.assigneeName,
      },
      matchedId: null,
      matchConfidence: null,
    });
  }

  // 2. Catégories proposées
  for (const cat of result.proposedCategoryTags) {
    const name = cat.trim();
    if (!name) continue;
    // Cherche un tag catégorie existant avec ce nom (suffix après le
    // dernier "/").
    const [existing] = await conn
      .select({ id: gmailTags.id })
      .from(gmailTags)
      .where(
        and(
          eq(gmailTags.userId, msg.userId),
          eq(gmailTags.kind, "category"),
          sql`split_part(${gmailTags.labelName}, '/', -1) = ${name}`,
        ),
      )
      .limit(1);
    rows.push({
      messageId,
      kind: "category_tag",
      payload: { name, isNew: !existing },
      matchedId: existing?.id ?? null,
      matchConfidence: existing ? "1.000" : null,
    });
  }

  // 3. Project link inféré
  if (result.proposedProjectName) {
    const match = await fuzzyMatchProject(result.proposedProjectName);
    if (match) {
      rows.push({
        messageId,
        kind: "project_link",
        payload: { projectName: result.proposedProjectName, projectId: match.id },
        matchedId: match.id,
        matchConfidence: match.confidence.toFixed(3),
      });
    }
  }

  if (rows.length > 0) {
    await conn.insert(emailProposals).values(rows);
  }

  // Met à jour le summary + extractionStatus côté message.
  await conn
    .update(gmailMessages)
    .set({
      extractionStatus: "extracted",
      // On garde le snippet d'origine ; le summary va dans une autre
      // colonne si on l'ajoute plus tard. Pour l'instant le summary LLM
      // n'est stocké nulle part (UI le voit via les proposals si besoin).
    })
    .where(eq(gmailMessages.id, messageId));

  return { count: rows.length, skipped: false };
}
