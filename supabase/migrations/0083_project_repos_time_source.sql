-- =============================================================================
-- Suivi du temps passé dans Claude Code.
--
-- 1. `time_entries.source` : d'où vient un créneau (manual, calendar,
--    claude_code). Les créneaux miroirs d'un event Google (google_event_id
--    renseigné) passent en `calendar`, le reste reste `manual`.
-- 2. `time_entries.source_ref` : identifiant côté source, pour écrire de
--    façon idempotente. Le mod Claude Code réécrit le même segment
--    (`<sessionId>:<n>`) à chaque fin de tour en étendant end_at.
-- 3. `project_repos` : dépôts git rattachés à un projet, remote normalisé
--    (cf. lib/git/remote.ts). Un dépôt n'appartient qu'à un projet.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'time_entry_source') then
    create type public.time_entry_source as enum ('manual', 'calendar', 'claude_code');
  end if;
end $$;

alter table public.time_entries
  add column if not exists source public.time_entry_source not null default 'manual',
  add column if not exists source_ref text;

update public.time_entries
  set source = 'calendar'
  where google_event_id is not null and source = 'manual';

create unique index if not exists time_entries_source_ref_unique
  on public.time_entries (user_id, source, source_ref)
  where source_ref is not null;

comment on column public.time_entries.source is
  'Provenance du créneau : manual (saisie), calendar (event Google attribué), claude_code (mod Claude Code).';
comment on column public.time_entries.source_ref is
  'Identifiant côté source pour l''upsert (claude_code : <sessionId>:<segment>).';

create table if not exists public.project_repos (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  remote     text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists project_repos_remote_unique
  on public.project_repos (remote);
create index if not exists project_repos_project_idx
  on public.project_repos (project_id);

comment on table public.project_repos is
  'Dépôts git d''un projet, remote normalisé (github.com/owner/repo). Résolution projet du mod Claude Code.';

alter table public.project_repos enable row level security;

drop policy if exists "project_repos select all" on public.project_repos;
create policy "project_repos select all"
  on public.project_repos
  for select to authenticated using (true);

-- Équivalent ciblé de grant_paradeos_app() pour la seule table nouvelle.
-- La fonction globale repasse sur toutes les tables et attend un verrou sur
-- oauth_tokens (lue en continu par le serveur MCP) jusqu'au statement_timeout
-- du rôle postgres, ce qui annule toute la migration. Les grants eux-mêmes
-- viennent des default privileges posés en 0081 ; seule la policy manque.
drop policy if exists paradeos_app_all on public.project_repos;
create policy paradeos_app_all on public.project_repos
  for all to paradeos_app using (true) with check (true);
