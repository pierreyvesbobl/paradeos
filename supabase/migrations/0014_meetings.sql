-- Meetings : transcripts + résumés + propositions à valider par un humain.

do $$ begin
  create type meeting_status as enum ('ingested', 'extracted', 'reviewed', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type meeting_proposal_kind as enum ('task', 'project', 'opportunity', 'contact', 'entity');
exception when duplicate_object then null; end $$;

do $$ begin
  create type meeting_proposal_status as enum ('pending', 'accepted', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.meetings (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  occurred_at  timestamptz,
  transcript   text not null,
  summary      text,
  status       meeting_status not null default 'ingested',
  source_label text,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists meetings_status_idx on public.meetings(status);
create index if not exists meetings_occurred_at_idx on public.meetings(occurred_at);

drop trigger if exists meetings_touch_updated_at on public.meetings;
create trigger meetings_touch_updated_at
  before update on public.meetings
  for each row execute function public.touch_updated_at();

alter table public.meetings enable row level security;

drop policy if exists "meetings select auth" on public.meetings;
create policy "meetings select auth"
  on public.meetings for select to authenticated using (true);

drop policy if exists "meetings insert auth" on public.meetings;
create policy "meetings insert auth"
  on public.meetings for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "meetings update auth" on public.meetings;
create policy "meetings update auth"
  on public.meetings for update to authenticated using (true) with check (true);

drop policy if exists "meetings delete admin" on public.meetings;
create policy "meetings delete admin"
  on public.meetings for delete to authenticated
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.role = 'admin'
    )
  );

create table if not exists public.meeting_proposals (
  id                uuid primary key default gen_random_uuid(),
  meeting_id        uuid not null references public.meetings(id) on delete cascade,
  kind              meeting_proposal_kind not null,
  payload           jsonb not null,
  matched_id        uuid,
  match_confidence  numeric(4, 3),
  status            meeting_proposal_status not null default 'pending',
  created_entity_id uuid,
  decided_by        uuid references public.users(id) on delete set null,
  decided_at        timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists meeting_proposals_meeting_idx on public.meeting_proposals(meeting_id);
create index if not exists meeting_proposals_status_idx on public.meeting_proposals(status);

alter table public.meeting_proposals enable row level security;

drop policy if exists "meeting_proposals select auth" on public.meeting_proposals;
create policy "meeting_proposals select auth"
  on public.meeting_proposals for select to authenticated using (true);

drop policy if exists "meeting_proposals insert auth" on public.meeting_proposals;
create policy "meeting_proposals insert auth"
  on public.meeting_proposals for insert to authenticated with check (true);

drop policy if exists "meeting_proposals update auth" on public.meeting_proposals;
create policy "meeting_proposals update auth"
  on public.meeting_proposals for update to authenticated using (true) with check (true);

drop policy if exists "meeting_proposals delete admin" on public.meeting_proposals;
create policy "meeting_proposals delete admin"
  on public.meeting_proposals for delete to authenticated
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.role = 'admin'
    )
  );
