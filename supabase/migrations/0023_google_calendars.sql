-- Calendriers Google de l'utilisateur (synchronisés depuis calendarList)
-- + cache des events affichés dans /planning.

create table if not exists public.google_calendars (
  id                  uuid primary key default gen_random_uuid(),
  google_account_id   uuid not null references public.google_accounts(id) on delete cascade,
  calendar_id         text not null,
  summary             text not null,
  description         text,
  is_primary          boolean not null default false,
  background_color    text,
  foreground_color    text,
  sync_enabled        boolean not null default false,
  sync_token          text,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists google_calendars_account_calendar_unique
  on public.google_calendars (google_account_id, calendar_id);

alter table public.google_calendars enable row level security;

drop policy if exists "google_calendars select own" on public.google_calendars;
create policy "google_calendars select own"
  on public.google_calendars
  for select
  to authenticated
  using (
    exists (
      select 1 from public.google_accounts ga
      where ga.id = google_calendars.google_account_id
        and ga.user_id = auth.uid()
    )
  );

drop trigger if exists google_calendars_touch_updated_at on public.google_calendars;
create trigger google_calendars_touch_updated_at
  before update on public.google_calendars
  for each row execute function public.touch_updated_at();

create table if not exists public.calendar_events (
  id                  uuid primary key default gen_random_uuid(),
  google_calendar_id  uuid not null references public.google_calendars(id) on delete cascade,
  google_event_id     text not null,
  ical_uid            text,
  summary             text,
  description         text,
  location            text,
  start_at            timestamptz not null,
  end_at              timestamptz not null,
  all_day             boolean not null default false,
  status              text,
  html_link           text,
  organizer_email     text,
  attendees           jsonb,
  recurring_event_id  text,
  google_updated_at   timestamptz,
  fetched_at          timestamptz not null default now()
);

create unique index if not exists calendar_events_calendar_event_unique
  on public.calendar_events (google_calendar_id, google_event_id);

create index if not exists calendar_events_range_idx
  on public.calendar_events (google_calendar_id, start_at, end_at);

alter table public.calendar_events enable row level security;

drop policy if exists "calendar_events select own" on public.calendar_events;
create policy "calendar_events select own"
  on public.calendar_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.google_calendars gc
      join public.google_accounts ga on ga.id = gc.google_account_id
      where gc.id = calendar_events.google_calendar_id
        and ga.user_id = auth.uid()
    )
  );
