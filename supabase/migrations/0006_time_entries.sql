-- =============================================================================
-- Phase 4 — Time entries (planning calendrier).
--
-- RLS stricte : un user ne voit / écrit QUE ses propres entries (différent
-- de la phase 1 où tout est partagé). Les admins voient tout.
-- =============================================================================

-- Contrainte d'intégrité : start < end.
do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_name = 'time_entries' and constraint_name = 'time_entries_start_before_end'
  ) then
    alter table public.time_entries
      add constraint time_entries_start_before_end check (start_at < end_at);
  end if;
end $$;

drop trigger if exists time_entries_touch_updated_at on public.time_entries;
create trigger time_entries_touch_updated_at
  before update on public.time_entries
  for each row execute function public.touch_updated_at();

drop trigger if exists audit_log_time_entries on public.time_entries;
create trigger audit_log_time_entries
  after insert or update or delete on public.time_entries
  for each row execute function public.audit_log_trigger();

alter table public.time_entries enable row level security;

drop policy if exists time_entries_self_or_admin_select on public.time_entries;
create policy time_entries_self_or_admin_select
  on public.time_entries
  for select
  using (
    user_id = public.current_user_id()
    or public.is_admin()
  );

drop policy if exists time_entries_self_insert on public.time_entries;
create policy time_entries_self_insert
  on public.time_entries
  for insert
  with check (user_id = public.current_user_id());

drop policy if exists time_entries_self_update on public.time_entries;
create policy time_entries_self_update
  on public.time_entries
  for update
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

drop policy if exists time_entries_self_delete on public.time_entries;
create policy time_entries_self_delete
  on public.time_entries
  for delete
  using (user_id = public.current_user_id());
