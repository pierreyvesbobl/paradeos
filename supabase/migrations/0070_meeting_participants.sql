-- =============================================================================
-- Participants d'une réunion.
--
-- Avant : une réunion ne savait pas qui y était. Le LLM extrayait bien une
-- liste `attendees` du transcript, mais elle était jetée après l'appel —
-- ni stockée, ni affichée, ni réinjectée. Résultat : les prénoms seuls et
-- les « je m'en occupe » restaient ambigus à chaque extraction.
--
-- Après : `meeting_participants` relie une réunion à des membres de
-- l'équipe (`user_id`), des contacts CRM (`contact_id`) ou, à défaut, un
-- nom brut (`display_name`) quand la personne n'a pas encore de fiche.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

do $$ begin
  create type meeting_participant_source as enum ('manual', 'extraction');
exception when duplicate_object then null; end $$;

create table if not exists public.meeting_participants (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references public.meetings(id) on delete cascade,
  user_id      uuid references public.users(id) on delete cascade,
  contact_id   uuid references public.contacts(id) on delete cascade,
  display_name text,
  role         text,
  source       meeting_participant_source not null default 'manual',
  added_by     uuid references public.users(id) on delete set null,
  added_at     timestamptz not null default now()
);

-- Exactement une cible par ligne : un membre, un contact, ou un nom brut.
do $$ begin
  alter table public.meeting_participants
    add constraint meeting_participants_target_chk
    check (
      (user_id is not null)::int
      + (contact_id is not null)::int
      + (nullif(btrim(coalesce(display_name, '')), '') is not null)::int = 1
    );
exception when duplicate_object then null; end $$;

create index if not exists meeting_participants_meeting_idx
  on public.meeting_participants (meeting_id);
create index if not exists meeting_participants_contact_idx
  on public.meeting_participants (contact_id);
create index if not exists meeting_participants_user_idx
  on public.meeting_participants (user_id);

-- Uniques partiels : pas deux fois la même personne sur une réunion, sans
-- contraindre les lignes en nom libre (qui n'ont ni user_id ni contact_id).
create unique index if not exists meeting_participants_user_unique
  on public.meeting_participants (meeting_id, user_id)
  where user_id is not null;
create unique index if not exists meeting_participants_contact_unique
  on public.meeting_participants (meeting_id, contact_id)
  where contact_id is not null;
create unique index if not exists meeting_participants_name_unique
  on public.meeting_participants (meeting_id, lower(display_name))
  where display_name is not null;

alter table public.meeting_participants enable row level security;

drop policy if exists "meeting_participants select all" on public.meeting_participants;
create policy "meeting_participants select all"
  on public.meeting_participants
  for select to authenticated using (true);
