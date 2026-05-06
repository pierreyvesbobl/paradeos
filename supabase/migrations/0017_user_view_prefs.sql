-- Préférences d'affichage par utilisateur et par page (filtres, tris,
-- recherche). Une ligne par couple (user_id, page_key). RLS strictement
-- user-scoped : chaque user ne voit/modifie que ses propres lignes.

create table if not exists public.user_view_prefs (
  user_id     uuid not null references public.users(id) on delete cascade,
  page_key    text not null,
  params      text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (user_id, page_key)
);

alter table public.user_view_prefs enable row level security;

drop policy if exists "view_prefs select own" on public.user_view_prefs;
create policy "view_prefs select own"
  on public.user_view_prefs
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "view_prefs insert own" on public.user_view_prefs;
create policy "view_prefs insert own"
  on public.user_view_prefs
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "view_prefs update own" on public.user_view_prefs;
create policy "view_prefs update own"
  on public.user_view_prefs
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "view_prefs delete own" on public.user_view_prefs;
create policy "view_prefs delete own"
  on public.user_view_prefs
  for delete
  to authenticated
  using (user_id = auth.uid());

drop trigger if exists user_view_prefs_touch_updated_at on public.user_view_prefs;
create trigger user_view_prefs_touch_updated_at
  before update on public.user_view_prefs
  for each row execute function public.touch_updated_at();
