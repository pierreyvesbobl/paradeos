import "server-only";

import { contacts } from "@/db/schema/contacts";
import { linkedinConnections } from "@/db/schema/linkedin";
import { findContactByEmail } from "@/lib/db/queries/contacts";
import { db } from "@/lib/db/server";
import { sanitizeNameInput } from "@/lib/format";
import { fuzzyMatchContact } from "@/lib/meetings/extract";
import { and, eq, isNotNull } from "drizzle-orm";
import { normalizeLinkedinIdentifier } from "./identity";

/**
 * Rapprochement des relations LinkedIn avec les contacts du CRM.
 *
 * La règle, dans l'ordre :
 *  1. email exact           → fusion automatique
 *  2. URL LinkedIn connue   → fusion automatique
 *  3. tout le reste         → file d'attente (`pending`), décision humaine
 *
 * Le point important est la marche à ne pas franchir : on ne crée ni ne
 * fusionne JAMAIS un contact sur une simple ressemblance de nom. Deux
 * homonymes fusionnés se réparent beaucoup plus difficilement qu'une
 * ligne restée en attente. Le fuzzy sert uniquement à *proposer* un
 * rapprochement, avec son score, jamais à décider.
 */

export type MatchOutcome = {
  autoMerged: number;
  pending: number;
  skipped: number;
};

/** Enrichissement : on ne remplit que les trous, jamais d'écrasement. */
type ContactPatch = {
  linkedinUrl?: string;
  jobTitle?: string;
};

/**
 * Passe de rapprochement sur les relations pas encore décidées.
 * Idempotente : une relation déjà décidée (`auto_merged`, `created`,
 * `ignored`) n'est jamais reprise — sinon un ré-import reviendrait sur
 * un choix humain.
 */
export async function matchPendingConnections(userId: string): Promise<MatchOutcome> {
  const conn = await db();
  const outcome: MatchOutcome = { autoMerged: 0, pending: 0, skipped: 0 };

  const rows = await conn
    .select()
    .from(linkedinConnections)
    .where(
      and(eq(linkedinConnections.userId, userId), eq(linkedinConnections.matchStatus, "pending")),
    );
  if (rows.length === 0) return outcome;

  // Le volume de contacts se compte en centaines : les charger une fois
  // coûte moins qu'une requête par relation, et évite d'ajouter un index
  // sur une expression de `contacts.linkedin_url`.
  const contactsWithLinkedin = await conn
    .select({
      id: contacts.id,
      linkedinUrl: contacts.linkedinUrl,
      jobTitle: contacts.jobTitle,
    })
    .from(contacts)
    .where(isNotNull(contacts.linkedinUrl));

  const byLinkedinSlug = new Map<string, { id: string; jobTitle: string | null }>();
  for (const c of contactsWithLinkedin) {
    const slug = normalizeLinkedinIdentifier(c.linkedinUrl);
    // Premier arrivé gagne : si deux contacts portent la même URL, c'est
    // un doublon à traiter à la main, pas une raison de choisir au hasard.
    if (slug && !byLinkedinSlug.has(slug)) {
      byLinkedinSlug.set(slug, { id: c.id, jobTitle: c.jobTitle });
    }
  }

  for (const row of rows) {
    try {
      // 1. Email — la preuve d'identité la plus solide.
      let contactId: string | null = null;
      if (row.email) {
        const found = await findContactByEmail(row.email);
        if (found) contactId = found.id;
      }

      // 2. URL LinkedIn déjà renseignée sur une fiche contact.
      if (!contactId && row.publicIdentifier) {
        const slug = normalizeLinkedinIdentifier(row.publicIdentifier);
        const hit = slug ? byLinkedinSlug.get(slug) : undefined;
        if (hit) contactId = hit.id;
      }

      if (contactId) {
        await enrichContact(contactId, row);
        await conn
          .update(linkedinConnections)
          .set({
            matchedContactId: contactId,
            matchStatus: "auto_merged",
            matchConfidence: "1.000",
            decidedAt: new Date(),
          })
          .where(eq(linkedinConnections.id, row.id));
        outcome.autoMerged += 1;
        continue;
      }

      // 3. Aucune preuve : on propose, on ne décide pas.
      const first = sanitizeNameInput(row.firstName) ?? "";
      const last = sanitizeNameInput(row.lastName) ?? "";
      const suggestion = first || last ? await fuzzyMatchContact(first, last) : null;

      await conn
        .update(linkedinConnections)
        .set({
          matchedContactId: suggestion?.id ?? null,
          matchConfidence: suggestion ? suggestion.confidence.toFixed(3) : null,
          // Reste `pending` : c'est une suggestion, pas une décision.
        })
        .where(eq(linkedinConnections.id, row.id));
      outcome.pending += 1;
    } catch (err) {
      console.error("[linkedin match]", row.memberUrn, err);
      outcome.skipped += 1;
    }
  }

  return outcome;
}

/**
 * Complète un contact existant avec ce que LinkedIn apporte, sans
 * jamais écraser une saisie manuelle — même principe que
 * `scripts/import-automato.ts`.
 */
async function enrichContact(
  contactId: string,
  row: typeof linkedinConnections.$inferSelect,
): Promise<void> {
  const conn = await db();
  const [existing] = await conn
    .select({
      linkedinUrl: contacts.linkedinUrl,
      jobTitle: contacts.jobTitle,
    })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  if (!existing) return;

  const patch: ContactPatch = {};
  if (!existing.linkedinUrl && row.profileUrl) patch.linkedinUrl = row.profileUrl;
  if (!existing.jobTitle) {
    const title = row.position ?? row.headline;
    if (title) patch.jobTitle = title.slice(0, 200);
  }

  if (Object.keys(patch).length > 0) {
    await conn.update(contacts).set(patch).where(eq(contacts.id, contactId));
  }
}
