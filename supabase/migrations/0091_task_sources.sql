-- =============================================================================
-- Sources d'une tâche : ce que le client (ou l'équipe) en a dit, mot pour
-- mot, dans les réunions et les mails.
--
-- Jusqu'ici une tâche née d'une extraction ne gardait que son titre : la
-- citation qui l'avait motivée restait dans le transcript, et les réunions
-- suivantes qui en reparlaient n'y laissaient rien. Cette table accumule
-- les passages verbatim, datés et attribués, pour qu'un brief (fiche
-- tâche, issue GitHub…) puisse les restituer sans relire les sources.
--
-- `relation` :
--   - origin     : la tâche a été créée d'après ce passage ;
--   - mention    : la tâche, déjà ouverte, est réévoquée (précision,
--                  relance, nouvelle contrainte) ;
--   - completion : le passage la donne pour faite (= evidence d'une
--                  proposition task_completion).
--
-- Une source est soit une réunion, soit un message Gmail (check). L'unicité
-- (tâche, source, empreinte du passage) rend les ré-extractions
-- idempotentes ; l'empreinte normalise blancs, casse et ponctuation
-- (cf. lib/tasks/task-sources.ts).
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_source_kind') then
    create type public.task_source_kind as enum ('meeting', 'email');
  end if;
  if not exists (select 1 from pg_type where typname = 'task_source_relation') then
    create type public.task_source_relation as enum ('origin', 'mention', 'completion');
  end if;
end $$;

create table if not exists public.task_sources (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references public.tasks(id) on delete cascade,
  source_kind         public.task_source_kind not null,
  meeting_id          uuid references public.meetings(id) on delete cascade,
  message_id          uuid references public.gmail_messages(id) on delete cascade,
  relation            public.task_source_relation not null,
  excerpt             text not null,
  speaker             text,
  excerpt_fingerprint text not null,
  created_at          timestamptz not null default now(),
  constraint task_sources_one_source check (
    (source_kind = 'meeting' and meeting_id is not null and message_id is null) or
    (source_kind = 'email'   and message_id is not null and meeting_id is null)
  )
);

create index if not exists task_sources_task_idx on public.task_sources (task_id);
create index if not exists task_sources_meeting_idx on public.task_sources (meeting_id)
  where meeting_id is not null;
create index if not exists task_sources_message_idx on public.task_sources (message_id)
  where message_id is not null;
create unique index if not exists task_sources_meeting_excerpt_unique
  on public.task_sources (task_id, meeting_id, excerpt_fingerprint)
  where meeting_id is not null;
create unique index if not exists task_sources_message_excerpt_unique
  on public.task_sources (task_id, message_id, excerpt_fingerprint)
  where message_id is not null;

comment on table public.task_sources is
  'Passages verbatim des réunions et mails qui parlent d''une tâche (origine, mention, clôture). Alimente les briefs.';
comment on column public.task_sources.relation is
  'origin = la tâche vient de ce passage ; mention = réévoquée ; completion = donnée pour faite.';
comment on column public.task_sources.excerpt_fingerprint is
  'Empreinte normalisée du passage (lib/tasks/task-sources.ts), pour l''idempotence des ré-extractions.';

alter table public.task_sources enable row level security;

drop policy if exists "task_sources select all" on public.task_sources;
create policy "task_sources select all"
  on public.task_sources
  for select to authenticated using (true);

-- Équivalent ciblé de grant_paradeos_app() pour la seule table nouvelle
-- (la fonction globale expire sur oauth_tokens, cf. 0083). Les grants
-- viennent des default privileges posés en 0081 ; seule la policy manque.
drop policy if exists paradeos_app_all on public.task_sources;
create policy paradeos_app_all on public.task_sources
  for all to paradeos_app using (true) with check (true);
