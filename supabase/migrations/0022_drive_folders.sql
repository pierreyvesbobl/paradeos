-- Lien dossier Drive ←→ sujet métier (un dossier max par sujet).
-- Le contenu du dossier est listé live via l'API Drive — on ne stocke
-- ici que le pointeur + le chemin résolu pour reconstruire le chemin
-- local Google Drive Desktop.

create table if not exists public.drive_folders (
  id                  uuid primary key default gen_random_uuid(),
  google_account_id   uuid not null references public.google_accounts(id) on delete cascade,
  subject_type        public.drive_file_subject_type not null,
  subject_id          uuid not null,
  folder_id           text not null,
  folder_name         text not null,
  folder_url          text,
  folder_path         text,
  added_by            uuid references public.users(id) on delete set null,
  added_at            timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists drive_folders_subject_unique
  on public.drive_folders (subject_type, subject_id);

alter table public.drive_folders enable row level security;

drop policy if exists "drive_folders select all" on public.drive_folders;
create policy "drive_folders select all"
  on public.drive_folders
  for select
  to authenticated
  using (true);

drop trigger if exists drive_folders_touch_updated_at on public.drive_folders;
create trigger drive_folders_touch_updated_at
  before update on public.drive_folders
  for each row execute function public.touch_updated_at();
