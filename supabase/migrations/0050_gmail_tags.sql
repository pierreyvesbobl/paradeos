-- Gmail tags : refonte du modèle de rattachement.
-- Avant : gmail_links polymorphe (thread → project/contact/entity, source auto/manual).
-- Après : gmail_tags = miroir des labels Gmail (incluant projets, contacts,
-- entités, catégories libres "Compta", "Annexe", etc.) + M2M
-- gmail_thread_tags. Gmail reste la source de vérité, Paradeos mirror.
--
-- Migration sans data : gmail_links était fraîchement créée (hier),
-- les rares lignes seront recréées au prochain sync (auto-tag par contact
-- match) + au prochain push (label_id Gmail rempli quand on lit la
-- liste des labels).

do $$ begin
  if not exists (select 1 from pg_type where typname = 'gmail_tag_kind') then
    create type gmail_tag_kind as enum ('project', 'contact', 'entity', 'category');
  end if;
end $$;

create table if not exists public.gmail_tags (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  kind            gmail_tag_kind not null,
  -- Pour kind=project/contact/entity : id du record CRM correspondant.
  -- Pour kind=category : null (le tag est une simple catégorie libre).
  target_id       uuid,
  -- Nom du label tel qu'il apparaît dans Gmail (ex. "Paradeos/Projet/Avenir Focus").
  label_name      text not null,
  -- ID Gmail du label (peut être null si pas encore créé côté Gmail —
  -- on le crée à la première utilisation).
  gmail_label_id  text,
  -- Couleur hex (optionnelle, exposable via Gmail label color API).
  color           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Un seul tag par target côté CRM (un projet = un seul label).
  constraint gmail_tags_target_unique unique (user_id, kind, target_id),
  -- Le nom de label est unique côté Gmail.
  constraint gmail_tags_label_name_unique unique (user_id, label_name)
);

create index if not exists gmail_tags_user_kind_idx on public.gmail_tags (user_id, kind);
create index if not exists gmail_tags_target_idx on public.gmail_tags (kind, target_id) where target_id is not null;
create index if not exists gmail_tags_label_id_idx on public.gmail_tags (user_id, gmail_label_id) where gmail_label_id is not null;

drop trigger if exists gmail_tags_touch_updated_at on public.gmail_tags;
create trigger gmail_tags_touch_updated_at
  before update on public.gmail_tags
  for each row execute function public.touch_updated_at();

alter table public.gmail_tags enable row level security;

drop policy if exists "gmail_tags select auth" on public.gmail_tags;
create policy "gmail_tags select auth"
  on public.gmail_tags for select to authenticated using (true);

drop policy if exists "gmail_tags insert auth" on public.gmail_tags;
create policy "gmail_tags insert auth"
  on public.gmail_tags for insert to authenticated with check (true);

drop policy if exists "gmail_tags update auth" on public.gmail_tags;
create policy "gmail_tags update auth"
  on public.gmail_tags for update to authenticated using (true) with check (true);

drop policy if exists "gmail_tags delete auth" on public.gmail_tags;
create policy "gmail_tags delete auth"
  on public.gmail_tags for delete to authenticated using (true);

-- ─── M2M thread × tag ──────────────────────────────────────────────

create table if not exists public.gmail_thread_tags (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references public.gmail_threads(id) on delete cascade,
  tag_id          uuid not null references public.gmail_tags(id) on delete cascade,
  -- 'auto' : appliqué par Paradeos (auto-link par contact match)
  -- 'gmail' : remonté depuis Gmail (l'utilisateur l'a mis dans Gmail)
  -- 'manual' : ajouté via UI Paradeos
  source          text not null default 'gmail',
  created_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null,
  constraint gmail_thread_tags_unique unique (thread_id, tag_id)
);

create index if not exists gmail_thread_tags_thread_idx on public.gmail_thread_tags (thread_id);
create index if not exists gmail_thread_tags_tag_idx on public.gmail_thread_tags (tag_id);

alter table public.gmail_thread_tags enable row level security;

drop policy if exists "gmail_thread_tags select auth" on public.gmail_thread_tags;
create policy "gmail_thread_tags select auth"
  on public.gmail_thread_tags for select to authenticated using (true);

drop policy if exists "gmail_thread_tags insert auth" on public.gmail_thread_tags;
create policy "gmail_thread_tags insert auth"
  on public.gmail_thread_tags for insert to authenticated with check (true);

drop policy if exists "gmail_thread_tags delete auth" on public.gmail_thread_tags;
create policy "gmail_thread_tags delete auth"
  on public.gmail_thread_tags for delete to authenticated using (true);

-- ─── Drop l'ancienne table gmail_links ────────────────────────────

drop table if exists public.gmail_links;
drop type if exists gmail_link_kind;
drop type if exists gmail_link_source;
