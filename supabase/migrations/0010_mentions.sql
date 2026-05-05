-- =============================================================================
-- Mentions @user dans les notes — RLS authentifié r/w pour permettre
-- l'indexation à l'enregistrement et la lecture côté UI (cloche).
-- =============================================================================

drop trigger if exists audit_log_mentions on public.mentions;
create trigger audit_log_mentions
  after insert or update or delete on public.mentions
  for each row execute function public.audit_log_trigger();

alter table public.mentions enable row level security;

drop policy if exists mentions_authenticated_select on public.mentions;
create policy mentions_authenticated_select
  on public.mentions
  for select
  using (true);

drop policy if exists mentions_authenticated_insert on public.mentions;
create policy mentions_authenticated_insert
  on public.mentions
  for insert
  with check (true);

drop policy if exists mentions_authenticated_update on public.mentions;
create policy mentions_authenticated_update
  on public.mentions
  for update
  using (true)
  with check (true);

drop policy if exists mentions_authenticated_delete on public.mentions;
create policy mentions_authenticated_delete
  on public.mentions
  for delete
  using (true);
