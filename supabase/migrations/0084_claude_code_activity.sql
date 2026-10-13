-- =============================================================================
-- Activité Claude Code : un signal, pas un créneau.
--
-- Le mod `claude-mod/` poussait des `time_entries` en `kind = actual`, donc
-- comptés dans le réalisé, la marge et le TJM. Ce n'est pas ce qu'on veut :
-- le temps passé dans Claude Code est un indicateur d'où est parti l'effort,
-- que l'humain arbitre avec les autres sources (réunions, mails, calendrier)
-- avant de saisir un vrai créneau. Il vit donc dans sa propre table, hors de
-- tout agrégat de temps réalisé.
--
-- `source_ref` = `<sessionId>:<n° de segment>` : le mod réécrit le même
-- segment en étendant `ended_at`, l'upsert est idempotent.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

create table if not exists public.claude_code_activity (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete set null,
  remote      text,
  started_at  timestamptz not null,
  ended_at    timestamptz not null,
  source_ref  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint claude_code_activity_range check (ended_at > started_at)
);

create unique index if not exists claude_code_activity_source_ref_unique
  on public.claude_code_activity (user_id, source_ref);
create index if not exists claude_code_activity_user_start_idx
  on public.claude_code_activity (user_id, started_at);
create index if not exists claude_code_activity_project_start_idx
  on public.claude_code_activity (project_id, started_at);

comment on table public.claude_code_activity is
  'Segments de présence dans Claude Code poussés par le mod paradeos-temps. Signal d''imputation, jamais un créneau réalisé : ne jamais agréger avec time_entries.';
comment on column public.claude_code_activity.remote is
  'Dépôt git normalisé de la session (cf. lib/git/remote.ts), conservé même sans projet rattaché pour proposer le rattachement.';
comment on column public.claude_code_activity.source_ref is
  'Identifiant côté mod pour l''upsert : <sessionId>:<n° de segment>.';

alter table public.claude_code_activity enable row level security;

drop policy if exists "claude_code_activity select all" on public.claude_code_activity;
create policy "claude_code_activity select all"
  on public.claude_code_activity
  for select to authenticated using (true);

-- Équivalent ciblé de grant_paradeos_app() pour la seule table nouvelle : la
-- fonction globale attend un verrou sur oauth_tokens et expire (cf. 0083).
drop policy if exists paradeos_app_all on public.claude_code_activity;
create policy paradeos_app_all on public.claude_code_activity
  for all to paradeos_app using (true) with check (true);

-- Les segments déjà écrits en créneaux réalisés n'en sont plus : on les
-- retire du tracking (aucun à ce jour, le premier push n'a jamais abouti).
delete from public.time_entries where source = 'claude_code';

comment on column public.time_entries.source is
  'Provenance du créneau : manual (saisie) ou calendar (event Google attribué). La valeur claude_code n''est plus écrite — cf. claude_code_activity.';
