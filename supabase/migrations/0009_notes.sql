-- =============================================================================
-- Phase notes — table polymorphe `notes` (CR, mémos, points de contact).
-- Trigger updated_at + audit + indexes trigram pour recherche.
-- RLS phase 1 : tous authentifiés r/w, suppression réservée auteur ou admin.
-- =============================================================================

create index if not exists notes_content_trgm_idx
  on public.notes using gin (content gin_trgm_ops);

create index if not exists notes_title_trgm_idx
  on public.notes using gin (title gin_trgm_ops);

drop trigger if exists notes_touch_updated_at on public.notes;
create trigger notes_touch_updated_at
  before update on public.notes
  for each row execute function public.touch_updated_at();

drop trigger if exists audit_log_notes on public.notes;
create trigger audit_log_notes
  after insert or update or delete on public.notes
  for each row execute function public.audit_log_trigger();

alter table public.notes enable row level security;

drop policy if exists notes_authenticated_select on public.notes;
create policy notes_authenticated_select
  on public.notes
  for select
  using (true);

drop policy if exists notes_authenticated_insert on public.notes;
create policy notes_authenticated_insert
  on public.notes
  for insert
  with check (true);

drop policy if exists notes_authenticated_update on public.notes;
create policy notes_authenticated_update
  on public.notes
  for update
  using (true)
  with check (true);

drop policy if exists notes_author_or_admin_delete on public.notes;
create policy notes_author_or_admin_delete
  on public.notes
  for delete
  using (true);
