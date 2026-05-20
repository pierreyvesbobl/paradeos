-- Gmail : liens polymorphes entre un thread et un sujet CRM (projet /
-- contact / entité). Trois sources possibles :
--   - auto_contact : sender/recipient matche un contact → lié aux projets
--     de ce contact
--   - auto_llm     : extraction LLM a proposé un lien (validé)
--   - manual       : utilisateur a explicitement lié via le picker
--
-- Pas de FK sur link_id (polymorphe). L'intégrité référentielle est
-- gérée côté app — quand un projet/contact/entité est supprimé, ses
-- liens deviennent orphelins et sont nettoyés par le job de purge.

do $$ begin
  create type gmail_link_kind as enum ('project', 'contact', 'entity');
exception when duplicate_object then null; end $$;

do $$ begin
  create type gmail_link_source as enum ('auto_contact', 'auto_llm', 'manual');
exception when duplicate_object then null; end $$;

create table if not exists public.gmail_links (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references public.gmail_threads(id) on delete cascade,
  link_kind       gmail_link_kind not null,
  link_id         uuid not null,
  source          gmail_link_source not null,
  confidence      numeric(4, 3),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null,
  constraint gmail_links_unique unique (thread_id, link_kind, link_id)
);

create index if not exists gmail_links_thread_idx on public.gmail_links (thread_id);
create index if not exists gmail_links_target_idx on public.gmail_links (link_kind, link_id);

alter table public.gmail_links enable row level security;

drop policy if exists "gmail_links select auth" on public.gmail_links;
create policy "gmail_links select auth"
  on public.gmail_links for select to authenticated using (true);

drop policy if exists "gmail_links insert auth" on public.gmail_links;
create policy "gmail_links insert auth"
  on public.gmail_links for insert to authenticated with check (true);

drop policy if exists "gmail_links update auth" on public.gmail_links;
create policy "gmail_links update auth"
  on public.gmail_links for update to authenticated using (true) with check (true);

drop policy if exists "gmail_links delete auth" on public.gmail_links;
create policy "gmail_links delete auth"
  on public.gmail_links for delete to authenticated using (true);
