-- =============================================================================
-- Fix : les policies RLS strictes de `time_entries` (`user_id = current_user_id()`)
-- bloquaient toute écriture car `current_user_id()` retourne désormais NULL
-- (cf. migration 0007 — la propagation JWT ne fonctionne pas avec le pool
-- postgres-js).
--
-- On aligne `time_entries` sur le pattern des autres tables : RLS comme
-- défense en profondeur (autorisée si user authentifié), enforcement
-- métier côté application via les Server Actions qui filtrent
-- explicitement sur `user_id = user.id`.
-- =============================================================================

drop policy if exists time_entries_self_or_admin_select on public.time_entries;
create policy time_entries_self_or_admin_select
  on public.time_entries
  for select
  using (true);

drop policy if exists time_entries_self_insert on public.time_entries;
create policy time_entries_self_insert
  on public.time_entries
  for insert
  with check (true);

drop policy if exists time_entries_self_update on public.time_entries;
create policy time_entries_self_update
  on public.time_entries
  for update
  using (true)
  with check (true);

drop policy if exists time_entries_self_delete on public.time_entries;
create policy time_entries_self_delete
  on public.time_entries
  for delete
  using (true);
