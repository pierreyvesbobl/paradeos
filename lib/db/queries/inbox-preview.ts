import { emailProposals, gmailMessages } from "@/db/schema/gmail";
import { invoiceFilings } from "@/db/schema/invoice-filings";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { eq } from "drizzle-orm";

export type InboxPreview = {
  source: "email" | "meeting" | "filing" | "reconciliation";
  title: string;
  subtitle: string | null;
  /** URL vers la page pleine (fallback "voir en entier"). */
  externalHref: string | null;
  /** Paires meta clé/valeur (from, date, projet…). */
  meta: { label: string; value: string }[];
  /** Corps texte à afficher (email/meeting summary/transcript). */
  bodyText: string | null;
};

/**
 * Charge un aperçu pour l'item de l'inbox qui vient d'être cliqué.
 * Toutes les vérifications d'auth se font ici (requireUser + filtre
 * userId sur les tables gmail/filing).
 */
export async function getInboxPreview(
  source: "email" | "meeting" | "filing",
  sourceId: string,
): Promise<InboxPreview | null> {
  const user = await requireUser();
  const conn = await db();

  if (source === "email") {
    const [row] = await conn
      .select({
        subject: gmailMessages.subject,
        fromName: gmailMessages.fromName,
        fromEmail: gmailMessages.fromEmail,
        toEmails: gmailMessages.toEmails,
        internalDate: gmailMessages.internalDate,
        bodyText: gmailMessages.bodyText,
        threadId: gmailMessages.threadId,
        userId: gmailMessages.userId,
      })
      .from(emailProposals)
      .innerJoin(gmailMessages, eq(gmailMessages.id, emailProposals.messageId))
      .where(eq(emailProposals.id, sourceId))
      .limit(1);
    if (!row || row.userId !== user.id) return null;

    const sender = row.fromName
      ? `${row.fromName} <${row.fromEmail ?? ""}>`
      : (row.fromEmail ?? "Expéditeur inconnu");
    const meta: { label: string; value: string }[] = [{ label: "De", value: sender }];
    if (row.toEmails.length > 0) {
      meta.push({ label: "À", value: row.toEmails.join(", ") });
    }
    if (row.internalDate) {
      meta.push({
        label: "Reçu",
        value: row.internalDate.toLocaleString("fr-FR", {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      });
    }

    // On sert uniquement le bodyText en aperçu — le bodyHtml Gmail est
    // stocké brut (sanitize-html tourne dans le message-card côté client)
    // et un sanitize côté serveur alourdirait inutilement l'aperçu.
    return {
      source: "email",
      title: row.subject?.trim() || "(sans objet)",
      subtitle: null,
      externalHref: row.threadId ? `/emails/${row.threadId}` : null,
      meta,
      bodyText: row.bodyText,
    };
  }

  if (source === "meeting") {
    const [row] = await conn
      .select({
        title: meetings.title,
        occurredAt: meetings.occurredAt,
        summary: meetings.summary,
        transcript: meetings.transcript,
        meetingId: meetings.id,
      })
      .from(meetingProposals)
      .innerJoin(meetings, eq(meetings.id, meetingProposals.meetingId))
      .where(eq(meetingProposals.id, sourceId))
      .limit(1);
    if (!row) return null;

    const meta: { label: string; value: string }[] = [];
    if (row.occurredAt) {
      meta.push({
        label: "Date",
        value: row.occurredAt.toLocaleDateString("fr-FR", { dateStyle: "medium" }),
      });
    }

    // Priorité : summary (markdown court) sinon extrait du transcript.
    const bodyText =
      row.summary ??
      (row.transcript
        ? `${row.transcript.slice(0, 4000)}${row.transcript.length > 4000 ? "…" : ""}`
        : null);

    return {
      source: "meeting",
      title: row.title,
      subtitle: row.summary ? "Résumé" : row.transcript ? "Extrait du transcript" : null,
      externalHref: `/meetings/${row.meetingId}`,
      meta,
      bodyText,
    };
  }

  // Filing : pas de corps, juste les metadata + lien Drive.
  const [row] = await conn
    .select({
      supplierRaw: invoiceFilings.supplierRaw,
      supplierSanitized: invoiceFilings.supplierSanitized,
      originalFilename: invoiceFilings.originalFilename,
      prestationType: invoiceFilings.prestationType,
      invoiceDate: invoiceFilings.invoiceDate,
      driveFileId: invoiceFilings.driveFileId,
      userId: invoiceFilings.userId,
      errorMessage: invoiceFilings.errorMessage,
    })
    .from(invoiceFilings)
    .where(eq(invoiceFilings.id, sourceId))
    .limit(1);
  if (!row || row.userId !== user.id) return null;

  const supplier = row.supplierSanitized ?? row.supplierRaw ?? "Fournisseur inconnu";
  const meta: { label: string; value: string }[] = [];
  if (row.originalFilename) meta.push({ label: "Fichier", value: row.originalFilename });
  if (row.prestationType) meta.push({ label: "Prestation", value: row.prestationType });
  if (row.invoiceDate) meta.push({ label: "Date facture", value: row.invoiceDate });
  if (row.errorMessage) meta.push({ label: "Erreur", value: row.errorMessage });

  return {
    source: "filing",
    title: supplier,
    subtitle: "Classement en attente",
    externalHref: row.driveFileId
      ? `https://drive.google.com/file/d/${row.driveFileId}/view`
      : "/compta?tab=factures",
    meta,
    bodyText: null,
  };
}
