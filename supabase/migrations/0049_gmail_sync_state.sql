-- État de sync Gmail par utilisateur.
-- - last_history_id : cursor Gmail History API pour la sync incrémentale
-- - bootstrap_cursor : pageToken Gmail List API pendant le bootstrap
--   initial (3 derniers mois) qui s'étale sur N runs cron
-- - last_full_sync_at : marque la fin du bootstrap

create table if not exists public.gmail_sync_state (
  user_id              uuid primary key references public.users(id) on delete cascade,
  last_history_id      bigint,
  last_full_sync_at    timestamptz,
  last_incremental_at  timestamptz,
  bootstrap_cursor     text,
  last_error           text,
  updated_at           timestamptz not null default now()
);

drop trigger if exists gmail_sync_state_touch_updated_at on public.gmail_sync_state;
create trigger gmail_sync_state_touch_updated_at
  before update on public.gmail_sync_state
  for each row execute function public.touch_updated_at();

alter table public.gmail_sync_state enable row level security;

drop policy if exists "gmail_sync_state select auth" on public.gmail_sync_state;
create policy "gmail_sync_state select auth"
  on public.gmail_sync_state for select to authenticated using (true);

drop policy if exists "gmail_sync_state insert auth" on public.gmail_sync_state;
create policy "gmail_sync_state insert auth"
  on public.gmail_sync_state for insert to authenticated with check (true);

drop policy if exists "gmail_sync_state update auth" on public.gmail_sync_state;
create policy "gmail_sync_state update auth"
  on public.gmail_sync_state for update to authenticated using (true) with check (true);

drop policy if exists "gmail_sync_state delete auth" on public.gmail_sync_state;
create policy "gmail_sync_state delete auth"
  on public.gmail_sync_state for delete to authenticated using (true);
