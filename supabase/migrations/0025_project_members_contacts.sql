-- Membres et contacts liés à un projet (M2M).
--
-- `project_members` = collègues qui bossent sur le projet (en plus du
-- `owner_id` qui reste le lead unique). Utile pour scoper qui voit/édite
-- et pour pré-remplir l'attribution d'events/time_entries plus tard.
--
-- `project_contacts` = contacts CRM impliqués dans le projet (en plus
-- du `contact_id` "primary" déjà sur projects). Plusieurs interlocuteurs
-- côté client/prospect.

create table if not exists public.project_members (
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  added_by    uuid references public.users(id) on delete set null,
  added_at    timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_members_user_idx
  on public.project_members (user_id);

alter table public.project_members enable row level security;

drop policy if exists "project_members select all" on public.project_members;
create policy "project_members select all"
  on public.project_members
  for select to authenticated using (true);

create table if not exists public.project_contacts (
  project_id  uuid not null references public.projects(id) on delete cascade,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  added_by    uuid references public.users(id) on delete set null,
  added_at    timestamptz not null default now(),
  primary key (project_id, contact_id)
);

create index if not exists project_contacts_contact_idx
  on public.project_contacts (contact_id);

alter table public.project_contacts enable row level security;

drop policy if exists "project_contacts select all" on public.project_contacts;
create policy "project_contacts select all"
  on public.project_contacts
  for select to authenticated using (true);
