/**
 * Fusionne les réunions qui portent le même transcript.
 *
 * Elles datent d'avant le garde-fou par empreinte (`lib/meetings/dedupe.ts`,
 * migration 0072) : un transcript entré deux fois — copie Drive, mail puis
 * Drive, re-collage à la main — a produit deux fiches, deux extractions
 * payées et deux jeux de propositions dans /inbox.
 *
 * ## Quelle fiche garder
 *
 * Pas la plus ancienne : sur les paires réelles, c'est une fois sur deux la
 * plus récente qui porte le travail (résumé, propositions tranchées) tandis
 * que l'autre n'a jamais été dépouillée. On classe donc par substance, dans
 * cet ordre :
 *
 *   1. propositions déjà tranchées  — c'est du travail humain, il ne se
 *      recrée pas ;
 *   2. résumé présent ;
 *   3. projet rattaché ;
 *   4. nombre de propositions ;
 *   5. à égalité, la plus ancienne.
 *
 * ## Ce qui remonte de la fiche supprimée
 *
 *  - les participants, reparentés (`on conflict do nothing`) ;
 *  - les propositions **en attente** dont la clé de dédup
 *    (`lib/crm/proposal-keys.ts`, celle de /inbox) n'existe pas déjà sur la
 *    fiche gardée — les autres partent avec la ligne, c'est le doublon
 *    qu'on venait retirer ;
 *  - les champs que la fiche gardée n'a pas : date, projet, résumé, et
 *    surtout les identifiants de source (`source_drive_file_id`,
 *    `source_email_message_id`) et l'empreinte. Sans eux, le fichier Drive
 *    ou le mail d'origine re-rentrerait au prochain run ;
 *  - le titre, si celui de la fiche gardée n'est qu'un nom de fichier Meet
 *    horodaté et que l'autre est un titre écrit par un humain.
 *
 * Tout se joue dans une transaction par paire : la suppression précède la
 * reprise de l'empreinte, sinon l'unique partiel la refuserait.
 *
 *   pnpm tsx scripts/merge-duplicate-meetings.ts            # dry-run
 *   pnpm tsx scripts/merge-duplicate-meetings.ts --commit
 */

import { config } from "dotenv";
import postgres from "postgres";
import { type ProposalKind, payloadKey } from "@/lib/crm/proposal-keys";
import { parseDriveTranscriptName } from "@/lib/meetings/drive-filename";

config({ path: ".env.local" });

const COMMIT = process.argv.includes("--commit");

type MeetingRow = {
  id: string;
  title: string;
  occurred_at: Date | null;
  project_id: string | null;
  summary: string | null;
  source_label: string | null;
  source_drive_file_id: string | null;
  source_drive_file_modified_at: Date | null;
  source_email_message_id: string | null;
  source_email_from: string | null;
  source_email_received_at: Date | null;
  content_fingerprint: string | null;
  created_at: Date;
  fingerprint: string;
  props: number;
  decided: number;
  parts: number;
};

type ProposalRow = { id: string; kind: ProposalKind; payload: unknown; status: string };

/** Substance d'une fiche, du plus au moins déterminant (cf. en-tête). */
function score(row: MeetingRow): [number, number, number, number, number] {
  return [
    row.decided,
    row.summary ? 1 : 0,
    row.project_id ? 1 : 0,
    row.props,
    -row.created_at.getTime(),
  ];
}

function better(a: MeetingRow, b: MeetingRow): MeetingRow {
  const [sa, sb] = [score(a), score(b)];
  for (let i = 0; i < sa.length; i++) {
    if ((sa[i] as number) !== (sb[i] as number))
      return (sa[i] as number) > (sb[i] as number) ? a : b;
  }
  return a;
}

/**
 * Un titre qui n'est qu'un nom de fichier Meet (« … - 2026/07/03 10:28
 * CEST - Transcript ») vaut moins qu'un titre écrit à la main.
 */
function isFileName(title: string): boolean {
  return parseDriveTranscriptName(title).occurredAt !== null;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquant.");
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

  try {
    const rows = await sql<MeetingRow[]>`
      with fp as (
        select m.*,
               encode(
                 sha256(convert_to(btrim(regexp_replace(m.transcript, '[ \t\n\r\f\v]+', ' ', 'g')), 'UTF8')),
                 'hex'
               ) as fingerprint
          from public.meetings m
         where m.transcript is not null
           and length(btrim(regexp_replace(m.transcript, '[ \t\n\r\f\v]+', ' ', 'g'))) >= 50
      ),
      dup as (select fingerprint from fp group by fingerprint having count(*) > 1)
      select fp.id, fp.title, fp.occurred_at, fp.project_id, fp.summary, fp.source_label,
             fp.source_drive_file_id, fp.source_drive_file_modified_at,
             fp.source_email_message_id, fp.source_email_from, fp.source_email_received_at,
             fp.content_fingerprint, fp.created_at, fp.fingerprint,
             (select count(*)::int from public.meeting_proposals p where p.meeting_id = fp.id) as props,
             (select count(*)::int from public.meeting_proposals p
               where p.meeting_id = fp.id and p.status <> 'pending') as decided,
             (select count(*)::int from public.meeting_participants mp where mp.meeting_id = fp.id) as parts
        from fp join dup using (fingerprint)
       order by fp.fingerprint, fp.created_at asc`;

    const groups = new Map<string, MeetingRow[]>();
    for (const row of rows) {
      const list = groups.get(row.fingerprint) ?? [];
      list.push(row);
      groups.set(row.fingerprint, list);
    }

    let merged = 0;
    let movedProps = 0;
    let movedParts = 0;

    for (const [fingerprint, group] of groups) {
      const keep = group.reduce(better);
      const drops = group.filter((r) => r.id !== keep.id);

      console.info(`\n${fingerprint.slice(0, 8)} — garde « ${keep.title} »`);
      console.info(
        `    ${keep.decided} proposition(s) tranchée(s), résumé ${keep.summary ? "oui" : "non"}, projet ${keep.project_id ? "oui" : "non"}`,
      );

      for (const drop of drops) {
        console.info(`  supprime « ${drop.title} » (${drop.decided} tranchée(s))`);

        // Propositions en attente à récupérer : celles dont l'équivalent
        // n'est pas déjà sur la fiche gardée.
        const keepProps = await sql<ProposalRow[]>`
          select id, kind, payload, status from public.meeting_proposals where meeting_id = ${keep.id}`;
        const keepKeys = new Set(
          keepProps.map((p) => `${p.kind}:${payloadKey(p.kind, p.payload)}`),
        );
        const dropProps = await sql<ProposalRow[]>`
          select id, kind, payload, status
            from public.meeting_proposals
           where meeting_id = ${drop.id} and status = 'pending'`;
        const toMove = dropProps.filter(
          (p) => !keepKeys.has(`${p.kind}:${payloadKey(p.kind, p.payload)}`),
        );

        const newTitle = isFileName(keep.title) && !isFileName(drop.title) ? drop.title : null;
        if (newTitle) console.info(`    titre → « ${newTitle} »`);
        if (toMove.length > 0) {
          console.info(
            `    ${toMove.length} proposition(s) en attente reprise(s) : ${toMove
              .map((p) => p.kind)
              .join(", ")}`,
          );
        }
        if (drop.parts > 0) console.info(`    ${drop.parts} participant(s) reparenté(s)`);
        movedProps += toMove.length;
        movedParts += drop.parts;
        merged++;

        if (!COMMIT) continue;

        await sql.begin(async (tx) => {
          for (const prop of toMove) {
            await tx`update public.meeting_proposals set meeting_id = ${keep.id} where id = ${prop.id}`;
          }
          // Reparentage des participants : les uniques partiels
          // (user/contact/nom par réunion) écartent ceux déjà présents,
          // les lignes restées sur la fiche supprimée partent en cascade.
          await tx`
            update public.meeting_participants
               set meeting_id = ${keep.id}
             where meeting_id = ${drop.id}
               and not exists (
                 select 1 from public.meeting_participants k
                  where k.meeting_id = ${keep.id}
                    and (
                      (k.user_id is not null and k.user_id = meeting_participants.user_id)
                      or (k.contact_id is not null and k.contact_id = meeting_participants.contact_id)
                      or (k.display_name is not null
                          and lower(k.display_name) = lower(meeting_participants.display_name))
                    )
               )`;
          // La suppression d'abord : l'unique partiel sur
          // `content_fingerprint` refuserait de le voir sur deux lignes.
          await tx`delete from public.meetings where id = ${drop.id}`;
          await tx`
            update public.meetings
               set title = coalesce(${newTitle}, title),
                   occurred_at = coalesce(occurred_at, ${drop.occurred_at}),
                   project_id = coalesce(project_id, ${drop.project_id}),
                   summary = coalesce(summary, ${drop.summary}),
                   source_label = coalesce(source_label, ${drop.source_label}),
                   source_drive_file_id = coalesce(source_drive_file_id, ${drop.source_drive_file_id}),
                   source_drive_file_modified_at =
                     coalesce(source_drive_file_modified_at, ${drop.source_drive_file_modified_at}),
                   source_email_message_id =
                     coalesce(source_email_message_id, ${drop.source_email_message_id}),
                   source_email_from = coalesce(source_email_from, ${drop.source_email_from}),
                   source_email_received_at =
                     coalesce(source_email_received_at, ${drop.source_email_received_at}),
                   content_fingerprint = ${fingerprint},
                   updated_at = now()
             where id = ${keep.id}`;
        });
      }
    }

    console.info(
      `\n${groups.size} groupe(s), ${merged} fiche(s) supprimée(s), ${movedProps} proposition(s) et ${movedParts} participant(s) repris.`,
    );
    if (!COMMIT) console.info("Dry-run : rien n'a été écrit. Relance avec --commit.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
