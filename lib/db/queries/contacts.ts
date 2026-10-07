import "server-only";

import { contacts } from "@/db/schema/contacts";
import { contactHasEmail } from "@/lib/crm/contact-emails";
import { db } from "@/lib/db/server";

/**
 * Cherche un contact par adresse email (insensible à la casse), principale
 * **ou** secondaire (cf. `lib/crm/contact-emails.ts`). Utilise les index
 * `contacts_email_lower_idx` et `contact_emails_email_lower_unique`.
 *
 * Préféré au fuzzy match par nom pour les pipelines email : un email
 * exact est une preuve d'identité bien plus solide qu'un match
 * orthographique de prénom + nom.
 */
export async function findContactByEmail(
  email: string,
): Promise<{ id: string; firstName: string; lastName: string; email: string | null } | null> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return null;
  const conn = await db();
  const [row] = await conn
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
    })
    .from(contacts)
    .where(contactHasEmail(trimmed))
    .limit(1);
  return row ?? null;
}
