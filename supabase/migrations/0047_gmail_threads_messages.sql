-- Gmail : threads + messages ingérés depuis l'API Gmail v1.
-- Le body est nullable : on ne stocke que les emails où l'expéditeur ou
-- un destinataire matche un contact CRM ou un domaine d'entité connu.
-- Les autres ne sont indexés qu'au niveau métadonnées (headers + snippet)
-- pour rester searchable sans dupliquer toute la mailbox.

do $$ begin
  create type gmail_extraction_status as enum ('skipped', 'pending', 'extracted', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists public.gmail_threads (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  gmail_thread_id   text not null,
  subject           text,
  participants      jsonb not null default '[]'::jsonb,
  last_message_at   timestamptz,
  snippet           text,
  message_count     int not null default 0,
  has_unread        boolean not null default false,
  labels            text[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint gmail_threads_user_thread_unique unique (user_id, gmail_thread_id)
);

create index if not exists gmail_threads_user_last_msg_idx
  on public.gmail_threads (user_id, last_message_at desc);
create index if not exists gmail_threads_participants_gin
  on public.gmail_threads using gin (participants jsonb_path_ops);

drop trigger if exists gmail_threads_touch_updated_at on public.gmail_threads;
create trigger gmail_threads_touch_updated_at
  before update on public.gmail_threads
  for each row execute function public.touch_updated_at();

alter table public.gmail_threads enable row level security;

drop policy if exists "gmail_threads select auth" on public.gmail_threads;
create policy "gmail_threads select auth"
  on public.gmail_threads for select to authenticated using (true);

drop policy if exists "gmail_threads insert auth" on public.gmail_threads;
create policy "gmail_threads insert auth"
  on public.gmail_threads for insert to authenticated with check (true);

drop policy if exists "gmail_threads update auth" on public.gmail_threads;
create policy "gmail_threads update auth"
  on public.gmail_threads for update to authenticated using (true) with check (true);

drop policy if exists "gmail_threads delete auth" on public.gmail_threads;
create policy "gmail_threads delete auth"
  on public.gmail_threads for delete to authenticated using (true);

create table if not exists public.gmail_messages (
  id                  uuid primary key default gen_random_uuid(),
  thread_id           uuid not null references public.gmail_threads(id) on delete cascade,
  user_id             uuid not null references public.users(id) on delete cascade,
  gmail_message_id    text not null,
  from_email          text,
  from_name           text,
  to_emails           text[] not null default '{}',
  cc_emails           text[] not null default '{}',
  subject             text,
  snippet             text,
  body_text           text,
  body_html           text,
  internal_date       timestamptz,
  labels              text[] not null default '{}',
  is_draft            boolean not null default false,
  extraction_status   gmail_extraction_status not null default 'skipped',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint gmail_messages_user_msg_unique unique (user_id, gmail_message_id)
);

create index if not exists gmail_messages_thread_date_idx
  on public.gmail_messages (thread_id, internal_date desc);
create index if not exists gmail_messages_from_lower_idx
  on public.gmail_messages (lower(from_email));
create index if not exists gmail_messages_extraction_status_idx
  on public.gmail_messages (extraction_status)
  where extraction_status in ('pending', 'failed');

drop trigger if exists gmail_messages_touch_updated_at on public.gmail_messages;
create trigger gmail_messages_touch_updated_at
  before update on public.gmail_messages
  for each row execute function public.touch_updated_at();

alter table public.gmail_messages enable row level security;

drop policy if exists "gmail_messages select auth" on public.gmail_messages;
create policy "gmail_messages select auth"
  on public.gmail_messages for select to authenticated using (true);

drop policy if exists "gmail_messages insert auth" on public.gmail_messages;
create policy "gmail_messages insert auth"
  on public.gmail_messages for insert to authenticated with check (true);

drop policy if exists "gmail_messages update auth" on public.gmail_messages;
create policy "gmail_messages update auth"
  on public.gmail_messages for update to authenticated using (true) with check (true);

drop policy if exists "gmail_messages delete auth" on public.gmail_messages;
create policy "gmail_messages delete auth"
  on public.gmail_messages for delete to authenticated using (true);
