-- Réglages applicatifs sensibles (clé OpenAI, etc.). Accès strictement
-- réservé aux admins via RLS.

create table if not exists public.app_settings (
  key         text primary key,
  value       text,
  updated_by  uuid references public.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "app_settings select admin" on public.app_settings;
create policy "app_settings select admin"
  on public.app_settings
  for select
  to authenticated
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.role = 'admin'
    )
  );

drop policy if exists "app_settings insert admin" on public.app_settings;
create policy "app_settings insert admin"
  on public.app_settings
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.role = 'admin'
    )
  );

drop policy if exists "app_settings update admin" on public.app_settings;
create policy "app_settings update admin"
  on public.app_settings
  for update
  to authenticated
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.users
      where users.id = auth.uid() and users.role = 'admin'
    )
  );

drop trigger if exists app_settings_touch_updated_at on public.app_settings;
create trigger app_settings_touch_updated_at
  before update on public.app_settings
  for each row execute function public.touch_updated_at();
