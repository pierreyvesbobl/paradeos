-- =============================================================================
-- Phase 1 — Entités + Contacts.
--
-- Active pg_trgm, pose les indexes trigram pour la recherche, monte
-- les triggers updated_at + audit, et applique la RLS phase 1
-- (tous authentifiés r/w ; suppression réservée au créateur ou admin).
-- =============================================================================

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Indexes trigram pour la recherche full-text approximative.
-- ---------------------------------------------------------------------------
create index if not exists entities_name_trgm_idx
  on public.entities using gin (name gin_trgm_ops);

create index if not exists contacts_first_name_trgm_idx
  on public.contacts using gin (first_name gin_trgm_ops);

create index if not exists contacts_last_name_trgm_idx
  on public.contacts using gin (last_name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Maintien de updated_at (trigger défini phase 0).
-- ---------------------------------------------------------------------------
drop trigger if exists entities_touch_updated_at on public.entities;
create trigger entities_touch_updated_at
  before update on public.entities
  for each row execute function public.touch_updated_at();

drop trigger if exists contacts_touch_updated_at on public.contacts;
create trigger contacts_touch_updated_at
  before update on public.contacts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Audit log (trigger générique défini phase 0).
-- ---------------------------------------------------------------------------
drop trigger if exists audit_log_entities on public.entities;
create trigger audit_log_entities
  after insert or update or delete on public.entities
  for each row execute function public.audit_log_trigger();

drop trigger if exists audit_log_contacts on public.contacts;
create trigger audit_log_contacts
  after insert or update or delete on public.contacts
  for each row execute function public.audit_log_trigger();

-- ---------------------------------------------------------------------------
-- RLS — phase 1 : tous authentifiés en lecture/écriture, suppression
-- réservée au créateur ou à un admin.
-- ---------------------------------------------------------------------------
alter table public.entities enable row level security;
alter table public.contacts enable row level security;

-- entities ------------------------------------------------------------------
drop policy if exists entities_authenticated_select on public.entities;
create policy entities_authenticated_select
  on public.entities
  for select
  using (public.current_user_id() is not null);

drop policy if exists entities_authenticated_insert on public.entities;
create policy entities_authenticated_insert
  on public.entities
  for insert
  with check (public.current_user_id() is not null);

drop policy if exists entities_authenticated_update on public.entities;
create policy entities_authenticated_update
  on public.entities
  for update
  using (public.current_user_id() is not null)
  with check (public.current_user_id() is not null);

drop policy if exists entities_creator_or_admin_delete on public.entities;
create policy entities_creator_or_admin_delete
  on public.entities
  for delete
  using (
    created_by = public.current_user_id()
    or public.is_admin()
  );

-- contacts ------------------------------------------------------------------
drop policy if exists contacts_authenticated_select on public.contacts;
create policy contacts_authenticated_select
  on public.contacts
  for select
  using (public.current_user_id() is not null);

drop policy if exists contacts_authenticated_insert on public.contacts;
create policy contacts_authenticated_insert
  on public.contacts
  for insert
  with check (public.current_user_id() is not null);

drop policy if exists contacts_authenticated_update on public.contacts;
create policy contacts_authenticated_update
  on public.contacts
  for update
  using (public.current_user_id() is not null)
  with check (public.current_user_id() is not null);

drop policy if exists contacts_creator_or_admin_delete on public.contacts;
create policy contacts_creator_or_admin_delete
  on public.contacts
  for delete
  using (
    created_by = public.current_user_id()
    or public.is_admin()
  );
