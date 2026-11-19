-- =============================================================================
-- Rendez-vous Google Calendar → projet → temps (cf. lib/time/calendar-attach.ts)
--
-- `calendar_events` est un cache que la relève efface et réécrit : ce qu'on a
-- décidé d'un rendez-vous (projet reconnu, créneau posé, refus) vit ici, clé
-- stable (calendrier, id d'événement Google), la même que le miroir de
-- `time_entries`.
--
--  - suggested : projet reconnu, pas encore de créneau
--  - applied   : créneau réalisé posé (auto_at non nul = sans clic)
--  - dismissed : l'humain a supprimé ou refusé, on n'y revient plus
--  - unmatched : évalué, aucun projet ; réévalué à chaque relève
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'calendar_link_status') then
    create type public.calendar_link_status as enum ('suggested', 'applied', 'dismissed', 'unmatched');
  end if;
end $$;

create table if not exists public.calendar_event_links (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users(id) on delete cascade,
  google_calendar_id uuid not null references public.google_calendars(id) on delete cascade,
  google_event_id    text not null,
  status             public.calendar_link_status not null default 'unmatched',
  project_id         uuid references public.projects(id) on delete set null,
  meeting_id         uuid references public.meetings(id) on delete set null,
  score              numeric(4, 2),
  reasons            text,
  time_entry_id      uuid references public.time_entries(id) on delete set null,
  auto_at            timestamptz,
  checked_at         timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists calendar_event_links_event_unique
  on public.calendar_event_links (google_calendar_id, google_event_id);
create index if not exists calendar_event_links_user_status_idx
  on public.calendar_event_links (user_id, status);
create index if not exists calendar_event_links_time_entry_idx
  on public.calendar_event_links (time_entry_id);
create index if not exists calendar_event_links_meeting_idx
  on public.calendar_event_links (meeting_id);

comment on table public.calendar_event_links is
  'Rattachement d''un rendez-vous Google Calendar à un projet et au créneau de temps qui en découle.';

alter table public.calendar_event_links enable row level security;
drop policy if exists "calendar_event_links select own" on public.calendar_event_links;
create policy "calendar_event_links select own"
  on public.calendar_event_links for select to authenticated
  using (user_id = auth.uid());
drop policy if exists paradeos_app_all on public.calendar_event_links;
create policy paradeos_app_all on public.calendar_event_links
  for all to paradeos_app using (true) with check (true);
