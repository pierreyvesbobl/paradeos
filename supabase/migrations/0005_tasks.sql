-- =============================================================================
-- Phase 3 — Tâches.
--
-- Trigram pour la recherche texte. Triggers updated_at + audit.
-- RLS phase 1 : tous authentifiés r/w, delete réservé créateur/admin.
-- =============================================================================

create index if not exists tasks_title_trgm_idx
  on public.tasks using gin (title gin_trgm_ops);

drop trigger if exists tasks_touch_updated_at on public.tasks;
create trigger tasks_touch_updated_at
  before update on public.tasks
  for each row execute function public.touch_updated_at();

drop trigger if exists audit_log_tasks on public.tasks;
create trigger audit_log_tasks
  after insert or update or delete on public.tasks
  for each row execute function public.audit_log_trigger();

alter table public.tasks enable row level security;

drop policy if exists tasks_authenticated_select on public.tasks;
create policy tasks_authenticated_select
  on public.tasks
  for select
  using (public.current_user_id() is not null);

drop policy if exists tasks_authenticated_insert on public.tasks;
create policy tasks_authenticated_insert
  on public.tasks
  for insert
  with check (public.current_user_id() is not null);

drop policy if exists tasks_authenticated_update on public.tasks;
create policy tasks_authenticated_update
  on public.tasks
  for update
  using (public.current_user_id() is not null)
  with check (public.current_user_id() is not null);

drop policy if exists tasks_creator_or_admin_delete on public.tasks;
create policy tasks_creator_or_admin_delete
  on public.tasks
  for delete
  using (
    created_by = public.current_user_id()
    or public.is_admin()
  );
