import "server-only";

import { asc, eq } from "drizzle-orm";
import { contactEmails } from "@/db/schema/contact-emails";
import { db } from "@/lib/db/server";

export type ContactEmailRow = { id: string; email: string; label: string | null };

/** Adresses secondaires d'une fiche, dans l'ordre d'ajout (pour l'affichage). */
export async function listContactEmailRows(contactId: string): Promise<ContactEmailRow[]> {
  const conn = await db();
  return conn
    .select({ id: contactEmails.id, email: contactEmails.email, label: contactEmails.label })
    .from(contactEmails)
    .where(eq(contactEmails.contactId, contactId))
    .orderBy(asc(contactEmails.createdAt));
}
