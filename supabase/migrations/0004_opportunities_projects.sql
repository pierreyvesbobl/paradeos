-- =============================================================================
-- Phase 2 — Opportunités + Projets.
--
-- Pose les triggers updated_at + audit, applique la RLS phase 1
-- (tous authentifiés r/w ; suppression réservée au créateur ou admin).
-- =============================================================================

-- Indexes trigram pour la recherche texte.
create index if not exists projects_name_trgm_idx
  on public.projects using gin (name gin_trgm_ops);

create index if not exists opportunities_title_trgm_idx
  on public.opportunities using gin (title gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists opportunities_touch_updated_at on public.opportunities;
create trigger opportunities_touch_updated_at
  before update on public.opportunities
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
drop trigger if exists audit_log_projects on public.projects;
create trigger audit_log_projects
  after insert or update or delete on public.projects
  for each row execute function public.audit_log_trigger();

drop trigger if exists audit_log_opportunities on public.opportunities;
create trigger audit_log_opportunities
  after insert or update or delete on public.opportunities
  for each row execute function public.audit_log_trigger();

-- ---------------------------------------------------------------------------
-- RLS — phase 1 : tous authentifiés r/w, delete réservé au créateur/admin.
-- ---------------------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.opportunities enable row level security;

-- projects ------------------------------------------------------------------
drop policy if exists projects_authenticated_select on public.projects;
create policy projects_authenticated_select
  on public.projects
  for select
  using (public.current_user_id() is not null);

drop policy if exists projects_authenticated_insert on public.projects;
create policy projects_authenticated_insert
  on public.projects
  for insert
  with check (public.current_user_id() is not null);

drop policy if exists projects_authenticated_update on public.projects;
create policy projects_authenticated_update
  on public.projects
  for update
  using (public.current_user_id() is not null)
  with check (public.current_user_id() is not null);

drop policy if exists projects_creator_or_admin_delete on public.projects;
create policy projects_creator_or_admin_delete
  on public.projects
  for delete
  using (
    created_by = public.current_user_id()
    or public.is_admin()
  );

-- opportunities -------------------------------------------------------------
drop policy if exists opportunities_authenticated_select on public.opportunities;
create policy opportunities_authenticated_select
  on public.opportunities
  for select
  using (public.current_user_id() is not null);

drop policy if exists opportunities_authenticated_insert on public.opportunities;
create policy opportunities_authenticated_insert
  on public.opportunities
  for insert
  with check (public.current_user_id() is not null);

drop policy if exists opportunities_authenticated_update on public.opportunities;
create policy opportunities_authenticated_update
  on public.opportunities
  for update
  using (public.current_user_id() is not null)
  with check (public.current_user_id() is not null);

drop policy if exists opportunities_creator_or_admin_delete on public.opportunities;
create policy opportunities_creator_or_admin_delete
  on public.opportunities
  for delete
  using (
    created_by = public.current_user_id()
    or public.is_admin()
  );
