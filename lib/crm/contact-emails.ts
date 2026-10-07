import { asc, eq, type SQL, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { contactEmails } from "@/db/schema/contact-emails";
import { contacts } from "@/db/schema/contacts";
import { normalizeEmail } from "@/lib/crm/name-key";

/**
 * Un contact a plusieurs adresses : la principale (`contacts.email`) et des
 * secondaires (`contact_emails`). Tout ce qui **rapproche** sur l'email —
 * sync Gmail, onglet E-mails d'une fiche, réunions, LinkedIn, dédoublonnage,
 * recherche — doit regarder les deux, sinon la personne qui écrit depuis sa
 * boîte perso redevient une inconnue. Ce module est le seul endroit qui
 * connaît les deux sources ; les appelants ne font que composer.
 *
 * Pas de `server-only` : le serveur MCP (tsx, hors Next) l'utilise avec sa
 * propre connexion, comme `lib/crm/candidates.ts`.
 */

/** Toutes les adresses du contact, principale d'abord, normalisées. */
export async function allEmailsOfContact(conn: Database, contactId: string): Promise<string[]> {
  const [[primary], others] = await Promise.all([
    conn
      .select({ email: contacts.email })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1),
    conn
      .select({ email: contactEmails.email })
      .from(contactEmails)
      .where(eq(contactEmails.contactId, contactId))
      .orderBy(asc(contactEmails.createdAt)),
  ]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [primary?.email, ...others.map((o) => o.email)]) {
    const email = normalizeEmail(raw);
    if (email && !seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}

/** Adresses secondaires de plusieurs contacts, groupées par contact, normalisées. */
export async function secondaryEmailsByContact(
  conn: Database,
  contactIds?: string[],
): Promise<Map<string, string[]>> {
  if (contactIds && contactIds.length === 0) return new Map();
  const rows = await conn
    .select({ contactId: contactEmails.contactId, email: contactEmails.email })
    .from(contactEmails)
    .where(
      contactIds
        ? sql`${contactEmails.contactId} in (${sql.join(
            contactIds.map((id) => sql`${id}`),
            sql`, `,
          )})`
        : undefined,
    );
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const email = normalizeEmail(r.email);
    if (!email) continue;
    const list = map.get(r.contactId);
    if (list) list.push(email);
    else map.set(r.contactId, [email]);
  }
  return map;
}

/** Toutes les adresses connues du CRM (principales + secondaires), normalisées. */
export async function allKnownContactEmails(conn: Database): Promise<Set<string>> {
  const [primaries, others] = await Promise.all([
    conn.select({ email: contacts.email }).from(contacts).where(sql`${contacts.email} is not null`),
    conn.select({ email: contactEmails.email }).from(contactEmails),
  ]);
  const set = new Set<string>();
  for (const r of [...primaries, ...others]) {
    const email = normalizeEmail(r.email);
    if (email) set.add(email);
  }
  return set;
}

/**
 * Condition SQL : le contact courant (table `contacts` dans le FROM) porte
 * cette adresse, en principale ou en secondaire. `email` est normalisé ici.
 */
export function contactHasEmail(email: string): SQL {
  const needle = normalizeEmail(email);
  return sql`(lower(${contacts.email}) = ${needle} or exists (
    select 1 from ${contactEmails}
    where ${contactEmails.contactId} = ${contacts.id} and lower(${contactEmails.email}) = ${needle}
  ))`;
}

/** Variante multi-adresses de `contactHasEmail`. Liste vide → `false`. */
export function contactHasAnyEmail(emails: string[]): SQL {
  const needles = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (needles.length === 0) return sql`false`;
  const list = sql.join(
    needles.map((e) => sql`${e}`),
    sql`, `,
  );
  return sql`(lower(${contacts.email}) in (${list}) or exists (
    select 1 from ${contactEmails}
    where ${contactEmails.contactId} = ${contacts.id} and lower(${contactEmails.email}) in (${list})
  ))`;
}

/**
 * Condition SQL : une adresse du contact courant matche le motif ILIKE.
 * `unaccent` applique la normalisation d'accents des deux côtés (migration
 * 0041), comme le reste de la recherche CRM.
 */
export function contactEmailIlike(pattern: string, opts: { unaccent?: boolean } = {}): SQL {
  if (opts.unaccent) {
    return sql`(unaccent(coalesce(${contacts.email}, '')) ilike unaccent(${pattern}) or exists (
      select 1 from ${contactEmails}
      where ${contactEmails.contactId} = ${contacts.id}
        and unaccent(${contactEmails.email}) ilike unaccent(${pattern})
    ))`;
  }
  return sql`(${contacts.email} ilike ${pattern} or exists (
    select 1 from ${contactEmails}
    where ${contactEmails.contactId} = ${contacts.id} and ${contactEmails.email} ilike ${pattern}
  ))`;
}

/** Nombre d'adresses secondaires du contact courant (sous-requête scalaire). */
export const secondaryEmailCountSql = sql<number>`(
  select count(*)::int from ${contactEmails}
  where ${contactEmails.contactId} = ${contacts.id}
)`;
