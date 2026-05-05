-- =============================================================================
-- Phase 0 — RLS users + provisionnement automatique des profils.
--
-- Ce fichier suppose que la table `public.users` (cf. drizzle migrations) a
-- déjà été créée avec les colonnes : id (uuid PK), full_name, avatar_url,
-- role (enum user_role), created_at, updated_at.
--
-- Ordre d'application : drizzle:migrate AVANT supabase:db push.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers : récupération de l'uid courant et test du rôle admin.
-- ---------------------------------------------------------------------------
create or replace function public.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = public.current_user_id()
      and u.role = 'admin'
  )
$$;

-- ---------------------------------------------------------------------------
-- Provisionnement automatique : création d'un profil `public.users` à
-- chaque insertion dans `auth.users`. Idempotent via on conflict.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, full_name, avatar_url, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', null),
    'member'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Maintien de updated_at
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_touch_updated_at on public.users;
create trigger users_touch_updated_at
  before update on public.users
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — un user voit son profil ; admin voit tout.
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;

drop policy if exists users_select_self_or_admin on public.users;
create policy users_select_self_or_admin
  on public.users
  for select
  using (
    id = public.current_user_id()
    or public.is_admin()
  );

drop policy if exists users_update_self on public.users;
create policy users_update_self
  on public.users
  for update
  using (id = public.current_user_id())
  with check (
    id = public.current_user_id()
    -- empêche un user non-admin d'élever son rôle.
    and (
      role = (select role from public.users where id = public.current_user_id())
      or public.is_admin()
    )
  );

drop policy if exists users_admin_all on public.users;
create policy users_admin_all
  on public.users
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Tags / taggings — RLS basique : tout user authentifié peut lire et
-- écrire. À durcir quand on aura les permissions par projet (phase 3).
-- ---------------------------------------------------------------------------
alter table public.tags enable row level security;
alter table public.taggings enable row level security;

drop policy if exists tags_authenticated_all on public.tags;
create policy tags_authenticated_all
  on public.tags
  for all
  using (public.current_user_id() is not null)
  with check (public.current_user_id() is not null);

drop policy if exists taggings_authenticated_all on public.taggings;
create policy taggings_authenticated_all
  on public.taggings
  for all
  using (public.current_user_id() is not null)
  with check (public.current_user_id() is not null);

-- ---------------------------------------------------------------------------
-- Audit log — lecture admin uniquement, écriture via trigger système
-- (security definer du trigger d'audit). On bloque les inserts directs.
-- ---------------------------------------------------------------------------
alter table public.audit_log enable row level security;

drop policy if exists audit_log_admin_select on public.audit_log;
create policy audit_log_admin_select
  on public.audit_log
  for select
  using (public.is_admin());
