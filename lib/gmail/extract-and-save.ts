import "server-only";

import { emailProposals, gmailMessages, gmailTags } from "@/db/schema/gmail";
import { findContactByEmail } from "@/lib/db/queries/contacts";
import { db } from "@/lib/db/server";
import { extractEmail } from "@/lib/gmail/extract";
import { applyTagToThread } from "@/lib/gmail/tags";
import { fuzzyMatchContact, fuzzyMatchEntity, fuzzyMatchProject } from "@/lib/meetings/extract";
import { and, eq, sql } from "drizzle-orm";

type ProposalRow = {
  messageId: string;
  kind: "task" | "category_tag" | "project_link" | "contact" | "entity" | "project";
  payload: Record<string, unknown>;
  matchedId: string | null;
  matchConfidence: string | null;
};

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
  /** Tags projet appliqués directement (sans proposition à valider). */
  autoAppliedProjectLinks: number;
  skipped: boolean;
  reason?: string;
}> {
  const conn = await db();
  const [msg] = await conn
    .select()
    .from(gmailMessages)
    .where(eq(gmailMessages.id, messageId))
    .limit(1);
  if (!msg)
    return { count: 0, autoAppliedProjectLinks: 0, skipped: true, reason: "message introuvable" };

  // On a besoin d'un body pour extraire — un message en `skipped` n'a
  // pas de body stocké.
  if (!msg.bodyText && !msg.bodyHtml) {
    await conn
      .update(gmailMessages)
      .set({ extractionStatus: "failed" })
      .where(eq(gmailMessages.id, messageId));
    return { count: 0, autoAppliedProjectLinks: 0, skipped: true, reason: "pas de body" };
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
      toEmails: msg.toEmails,
      ccEmails: msg.ccEmails,
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
    return { count: 0, autoAppliedProjectLinks: 0, skipped: true, reason: "sensitive detected" };
  }

  // Wipe les anciennes propositions du message + ré-injecte.
  await conn.delete(emailProposals).where(eq(emailProposals.messageId, messageId));

  const rows: ProposalRow[] = [];

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

  // 2. Catégories proposées — UNIQUEMENT si elles existent déjà en base.
  // Le LLM est consigné de ne proposer que des catégories existantes
  // (cf. prompt), mais en défense en profondeur on filtre ici aussi :
  // pas de nouvelle catégorie créée par le LLM, jamais. La taxonomie
  // reste 100% gérée par l'utilisateur depuis /emails/tags.
  for (const cat of result.proposedCategoryTags) {
    const name = cat.trim();
    if (!name) continue;
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
    if (!existing) continue;
    rows.push({
      messageId,
      kind: "category_tag",
      payload: { name },
      matchedId: existing.id,
      matchConfidence: "1.000",
    });
  }

  // 3. Project link inféré → auto-apply (pas de proposition à valider).
  // L'auto-tag par contact match du sync gère déjà 90% des cas ; cette
  // branche couvre les emails où le LLM détecte un projet du contenu
  // au-delà du contact (ex. "concernant le projet X" mentionné dans un
  // email qui n'a pas de contact CRM dans les participants).
  let autoAppliedProjectLinks = 0;
  let autoLinkedProjectId: string | null = null;
  if (result.proposedProjectName) {
    const match = await fuzzyMatchProject(result.proposedProjectName);
    if (match) {
      autoLinkedProjectId = match.id;
      // Cherche le gmail_tag projet correspondant.
      const [projectTag] = await conn
        .select({ id: gmailTags.id })
        .from(gmailTags)
        .where(
          and(
            eq(gmailTags.userId, msg.userId),
            eq(gmailTags.kind, "project"),
            eq(gmailTags.targetId, match.id),
          ),
        )
        .limit(1);
      if (projectTag) {
        try {
          await applyTagToThread({
            userId: msg.userId,
            threadIdLocal: msg.threadId,
            tagId: projectTag.id,
            source: "auto",
          });
          autoAppliedProjectLinks++;
        } catch {
          // Push Gmail peut échouer (token, quota…) — on n'invalide pas
          // l'extraction pour autant, le tag DB est déjà posé.
        }
      }
      // Si le tag projet n'existe pas encore en base, on n'auto-applique
      // pas (sinon il faudrait aussi créer le label Gmail à la volée
      // pendant le sync, ce qui ajoute du coût). L'utilisateur peut
      // déclencher "Initialiser les tags CRM" depuis /emails/tags pour
      // créer tous les labels manquants.
    }
  }

  // 4. Entités proposées (nouvelles) — fuzzy match côté serveur en
  // défense en profondeur, même si le LLM est consigné de ne pas
  // re-proposer ce qui est dans le vocabulaire.
  for (const e of result.proposedEntities) {
    const name = e.name.trim();
    if (!name) continue;
    const match = await fuzzyMatchEntity(name);
    rows.push({
      messageId,
      kind: "entity",
      payload: { name, kind: e.kind },
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }

  // 5. Contacts proposés (nouveaux). Pour chaque contact :
  //   - Si email fourni → lookup exact. Si match, SKIP (contact connu).
  //   - Sinon fuzzy match par nom (comme meetings).
  // Le match exact par email court-circuite la proposition : c'est plus
  // précis et évite de polluer la file de propositions avec des contacts
  // qu'on a déjà.
  for (const c of result.proposedContacts) {
    const firstName = c.firstName.trim();
    const lastName = c.lastName.trim();
    if (!firstName && !lastName) continue;
    const email = c.email?.trim() ?? null;
    if (email) {
      const exact = await findContactByEmail(email);
      if (exact) continue; // contact déjà connu, rien à proposer
    }
    const match = firstName || lastName ? await fuzzyMatchContact(firstName, lastName) : null;
    rows.push({
      messageId,
      kind: "contact",
      payload: {
        firstName,
        lastName,
        email,
        jobTitle: c.jobTitle,
        entityName: c.entityName,
      },
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }

  // 6. Projets proposés (nouveaux). Garde-fou : si le projet correspond
  // à celui déjà auto-lié via `proposedProjectName` plus haut, on ne le
  // propose pas une seconde fois (double signal LLM).
  for (const p of result.proposedProjects) {
    const name = p.name.trim();
    if (!name) continue;
    const match = await fuzzyMatchProject(name);
    if (match && match.id === autoLinkedProjectId) continue;
    rows.push({
      messageId,
      kind: "project",
      payload: {
        name,
        kind: p.kind,
        entityName: p.entityName,
        status: p.status,
        valueAmount: p.valueAmount,
      },
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
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

  return { count: rows.length, autoAppliedProjectLinks, skipped: false };
}
