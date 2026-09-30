-- =============================================================================
-- Dédoublonnage des réunions ingérées.
--
-- Avant : l'idempotence reposait sur la source (`source_drive_file_id`,
-- `source_email_message_id`). Elle garantit qu'un fichier ou un message ne
-- produit qu'une réunion, mais pas qu'une réunion n'a qu'une fiche : une
-- copie Drive porte un id neuf, un transcript transféré par mail puis
-- déposé sur Drive entre deux fois, un re-collage à la main entre une
-- troisième. Chaque doublon coûte une extraction LLM et un jeu de
-- propositions à trier.
--
-- Après : `content_fingerprint` = SHA-256 du transcript, blancs normalisés.
-- L'index unique partiel rend le doublon impossible, même entre deux crons
-- simultanés. Le pendant JS est `transcriptFingerprint`
-- (lib/meetings/dedupe.ts) — les deux normalisations doivent rester
-- alignées : on replie les blancs ASCII et on ne touche pas à la casse
-- (un `lower()` dépend de la locale Postgres, pas le JS).
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

alter table public.meetings
  add column if not exists content_fingerprint text;

-- Backfill. Dans un groupe de doublons déjà en base, seule la plus ancienne
-- fiche prend l'empreinte : les suivantes restent sans, donc visibles et
-- fusionnables à la main, et une ré-ingestion du même transcript butera
-- désormais sur l'aînée.
with fingerprints as (
  select
    id,
    created_at,
    encode(
      sha256(
        convert_to(btrim(regexp_replace(transcript, '[ \t\n\r\f\v]+', ' ', 'g')), 'UTF8')
      ),
      'hex'
    ) as fingerprint
  from public.meetings
  where transcript is not null
    and length(btrim(regexp_replace(transcript, '[ \t\n\r\f\v]+', ' ', 'g'))) >= 50
),
oldest_per_group as (
  select id, fingerprint
  from (
    select
      id,
      fingerprint,
      row_number() over (partition by fingerprint order by created_at asc, id asc) as rn
    from fingerprints
  ) ranked
  where rn = 1
)
update public.meetings m
   set content_fingerprint = oldest_per_group.fingerprint
  from oldest_per_group
 where m.id = oldest_per_group.id
   and m.content_fingerprint is null;

create unique index if not exists meetings_content_fingerprint_unique
  on public.meetings (content_fingerprint)
  where content_fingerprint is not null;
