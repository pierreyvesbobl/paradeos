/**
 * One-shot : pour chaque entité sans `website`, dérive le domaine
 * dominant depuis les emails de ses contacts (ignore les domaines
 * génériques type gmail.com). Écrit `website = https://<domaine>` puis
 * relance l'auto-tagging sur les threads existants pour lier les emails
 * historiques aux projets nouvellement identifiables par domaine.
 *
 * Idempotent : n'écrase jamais un website existant, n'écrit rien quand
 * plusieurs domaines candidats sont ex æquo (signal ambigu).
 *
 * Usage : pnpm tsx scripts/backfill-entities-website-from-contacts.ts
 *         [--dry-run] [--retag]
 */
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import { GENERIC_EMAIL_DOMAINS, domainFromEmail } from "../lib/gmail/domain";

loadEnv({ path: ".env.local" });

const DRY_RUN = process.argv.includes("--dry-run");
const RETAG = process.argv.includes("--retag");

type EntityRow = { id: string; name: string };
type ContactRow = { entity_id: string; email: string };

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant.");
  const sql = postgres(dbUrl, { prepare: false, max: 2, onnotice: () => {} });

  try {
    const entities = await sql<EntityRow[]>`
      select id, name from entities where website is null
    `;
    console.log(`Entités sans website : ${entities.length}`);

    const targetEntityIds = entities.map((e) => e.id);
    if (targetEntityIds.length === 0) {
      console.log("Rien à faire.");
      return;
    }

    const contacts = await sql<ContactRow[]>`
      select entity_id, email
      from contacts
      where entity_id = any(${sql.array(targetEntityIds, 2950)})
        and email is not null
    `;

    // Pour chaque entité : tally des domaines non-génériques.
    const byEntity = new Map<string, Map<string, number>>();
    for (const c of contacts) {
      const d = domainFromEmail(c.email);
      if (!d || GENERIC_EMAIL_DOMAINS.has(d)) continue;
      let m = byEntity.get(c.entity_id);
      if (!m) {
        m = new Map<string, number>();
        byEntity.set(c.entity_id, m);
      }
      m.set(d, (m.get(d) ?? 0) + 1);
    }

    let updates = 0;
    let skippedAmbiguous = 0;
    let skippedNoDomain = 0;

    const updatedEntityIds: string[] = [];

    for (const e of entities) {
      const tally = byEntity.get(e.id);
      if (!tally || tally.size === 0) {
        skippedNoDomain++;
        continue;
      }
      const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      const top = sorted[0];
      if (!top) {
        skippedNoDomain++;
        continue;
      }
      const runnerUp = sorted[1];
      if (runnerUp && runnerUp[1] === top[1]) {
        skippedAmbiguous++;
        console.log(
          `  · ${e.name} : ambigu (${sorted.map(([d, n]) => `${d}=${n}`).join(", ")}) — skip`,
        );
        continue;
      }
      const website = `https://${top[0]}`;
      console.log(`  ✓ ${e.name} → ${website}`);
      if (!DRY_RUN) {
        await sql`update entities set website = ${website} where id = ${e.id}`;
        updatedEntityIds.push(e.id);
      }
      updates++;
    }

    console.log(
      `\nRésumé : ${updates} maj, ${skippedAmbiguous} ambiguës, ${skippedNoDomain} sans domaine utile`,
    );

    if (!DRY_RUN && RETAG) {
      console.log("\nRe-tagging des threads (SQL inline, safe, idempotent)…");
      const stats = await retagAllThreads(sql);
      console.log(
        `Re-tagging terminé : +${stats.newEntityTags} tag(s) entité, +${stats.newProjectTags} tag(s) projet sur ${stats.threadsScanned} threads.`,
      );
    } else if (!RETAG) {
      console.log(
        "\nPasse --retag pour rejouer autoTagThreadByParticipants sur les threads existants.",
      );
    }
  } finally {
    await sql.end({ timeout: 3 });
  }
}

/**
 * Rejoue l'auto-tagging sur tous les threads, réimplémenté en SQL pour
 * éviter d'importer `lib/gmail/tags.ts` (qui dépend de `server-only`).
 *
 * Réplique la logique de `computeThreadTaggingSignals` +
 * `autoTagThreadByParticipants` :
 *   - Match contact par email (from/to/cc).
 *   - Match entité par domaine (via entities.website) — non-génériques.
 *   - Entité rattachée au contact matché → également candidate (nouveau).
 *   - Candidats projet : project_contacts(contact) ∪ project.entity_id
 *     ∈ matched entities (non-archivés).
 *   - Tag entité : appliqué à toutes les entités matchées.
 *   - Tag projet : appliqué SEULEMENT si exactement 1 candidat et pas
 *     de tag projet manuellement scellé sur ce thread.
 */
async function retagAllThreads(sql: postgres.Sql) {
  const genericDomains = [...GENERIC_EMAIL_DOMAINS];
  let newEntityTags = 0;
  let newProjectTags = 0;

  const threads = await sql<{ id: string; user_id: string }[]>`
    select id, user_id from gmail_threads order by last_message_at desc nulls last
  `;

  for (const thread of threads) {
    const msgs = await sql<
      { from_email: string | null; to_emails: string[]; cc_emails: string[] }[]
    >`
      select from_email, to_emails, cc_emails
      from gmail_messages where thread_id = ${thread.id}
    `;
    const involved = new Set<string>();
    for (const m of msgs) {
      if (m.from_email) involved.add(m.from_email.toLowerCase());
      for (const e of m.to_emails ?? []) involved.add(e.toLowerCase());
      for (const e of m.cc_emails ?? []) involved.add(e.toLowerCase());
    }
    if (involved.size === 0) continue;
    const emails = [...involved];

    const matchedContacts = await sql<{ id: string; entity_id: string | null }[]>`
      select id, entity_id from contacts
      where lower(email) = any(${sql.array(emails, 25)})
    `;
    const matchedContactIds = matchedContacts.map((c) => c.id);
    const contactEntityIds = matchedContacts
      .map((c) => c.entity_id)
      .filter((id): id is string => !!id);

    const domainSet = new Set<string>();
    for (const e of emails) {
      const at = e.lastIndexOf("@");
      if (at < 0) continue;
      const d = e.slice(at + 1);
      if (!genericDomains.includes(d)) domainSet.add(d);
    }
    const domains = [...domainSet];

    const matchedEntityIds = new Set<string>(contactEntityIds);
    if (domains.length > 0) {
      const rows = await sql<{ id: string; website: string | null }[]>`
        select id, website from entities where website is not null
      `;
      for (const e of rows) {
        if (!e.website) continue;
        const trimmed = e.website.trim();
        try {
          const url = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
          const host = url.hostname.toLowerCase().replace(/^www\./, "");
          if (host && domains.includes(host)) matchedEntityIds.add(e.id);
        } catch {}
      }
    }

    // Candidats projet : via contacts M2M + via entités matchées.
    const candidateProjectIds = new Set<string>();
    if (matchedContactIds.length > 0) {
      const rows = await sql<{ id: string }[]>`
        select p.id from project_contacts pc
        join projects p on p.id = pc.project_id
        where pc.contact_id = any(${sql.array(matchedContactIds, 2950)})
          and p.status <> 'archived'
      `;
      for (const r of rows) candidateProjectIds.add(r.id);
    }
    if (matchedEntityIds.size > 0) {
      const rows = await sql<{ id: string }[]>`
        select id from projects
        where entity_id = any(${sql.array([...matchedEntityIds], 2950)})
          and status <> 'archived'
      `;
      for (const r of rows) candidateProjectIds.add(r.id);
    }

    const [lockedRow] = await sql<{ c: number }[]>`
      select count(*)::int as c
      from gmail_thread_tags gtt
      join gmail_tags gt on gt.id = gtt.tag_id
      where gtt.thread_id = ${thread.id}
        and gtt.manually_overridden = true
        and gt.kind = 'project'
    `;
    const projectLocked = (lockedRow?.c ?? 0) > 0;

    // Applique tag entité (pour toutes les entités matchées).
    for (const entityId of matchedEntityIds) {
      const inserted = await ensureAndAttachTag(sql, thread.user_id, thread.id, "entity", entityId);
      if (inserted) newEntityTags++;
    }

    // Applique tag projet seulement si un unique candidat et pas verrouillé.
    if (!projectLocked && candidateProjectIds.size === 1) {
      const [projectId] = [...candidateProjectIds];
      if (projectId) {
        const inserted = await ensureAndAttachTag(
          sql,
          thread.user_id,
          thread.id,
          "project",
          projectId,
        );
        if (inserted) newProjectTags++;
      }
    }
  }

  return { threadsScanned: threads.length, newEntityTags, newProjectTags };
}

/**
 * Idempotent : garantit un `gmail_tags` pour (userId, kind, targetId) et
 * insère un `gmail_thread_tags(thread_id, tag_id)` s'il manque. Retourne
 * true si une nouvelle association a été créée.
 */
async function ensureAndAttachTag(
  sql: postgres.Sql,
  userId: string,
  threadId: string,
  kind: "project" | "entity",
  targetId: string,
): Promise<boolean> {
  // Récupère le nom (pour construire le label_name).
  const nameRow =
    kind === "project"
      ? await sql<{ name: string }[]>`select name from projects where id = ${targetId} limit 1`
      : await sql<{ name: string }[]>`select name from entities where id = ${targetId} limit 1`;
  const first = nameRow[0];
  if (!first) return false;
  const seg = first.name.trim().replace(/\//g, " ").replace(/\s+/g, " ").slice(0, 80);
  const kindSeg = kind === "project" ? "Projets" : "Entités";
  const labelName = `Paradeos/${kindSeg}/${seg}`;

  const [tag] = await sql<{ id: string }[]>`
    insert into gmail_tags (user_id, kind, target_id, label_name)
    values (${userId}, ${kind}, ${targetId}, ${labelName})
    on conflict (user_id, kind, target_id) do update set label_name = excluded.label_name
    returning id
  `;
  if (!tag) return false;

  const inserted = await sql<{ id: string }[]>`
    insert into gmail_thread_tags (thread_id, tag_id, source)
    values (${threadId}, ${tag.id}, 'auto')
    on conflict do nothing
    returning id
  `;
  return inserted.length > 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
