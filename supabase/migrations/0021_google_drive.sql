-- Comptes Google connectés par les users (pour Drive en v1, puis Gmail
-- et Calendar plus tard via scopes incrémentaux). Tokens chiffrés AES-GCM
-- côté app — `*_enc` rappelle que ces colonnes ne contiennent pas du
-- texte brut. Cf. lib/crypto/secrets.ts.

create table if not exists public.google_accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  google_sub          text not null,
  email               text not null,
  access_token_enc    text not null,
  refresh_token_enc   text not null,
  expires_at          timestamptz not null,
  scopes              text[] not null,
  revoked_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists google_accounts_user_id_unique
  on public.google_accounts (user_id);

alter table public.google_accounts enable row level security;

drop policy if exists "google_accounts select own" on public.google_accounts;
create policy "google_accounts select own"
  on public.google_accounts
  for select
  to authenticated
  using (user_id = auth.uid());

-- Pas de policy insert/update/delete : ces opérations passent par les
-- routes serveur via le rôle `postgres` (bypass RLS — cf. lib/db/server.ts).
-- RLS reste activée comme défense en profondeur si on bascule vers un
-- mode JWT-propagé un jour.

drop trigger if exists google_accounts_touch_updated_at on public.google_accounts;
create trigger google_accounts_touch_updated_at
  before update on public.google_accounts
  for each row execute function public.touch_updated_at();

-- Fichiers Drive rattachés à un sujet métier (projet, entité, contact,
-- note, meeting). On stocke uniquement les métadonnées + le file_id —
-- le contenu reste dans Drive et l'ACL est gérée par Google.

do $$ begin
  create type public.drive_file_subject_type as enum (
    'entity', 'contact', 'project', 'note', 'meeting'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.drive_files (
  id                  uuid primary key default gen_random_uuid(),
  google_account_id   uuid not null references public.google_accounts(id) on delete cascade,
  subject_type        public.drive_file_subject_type not null,
  subject_id          uuid not null,
  file_id             text not null,
  name                text not null,
  mime_type           text,
  icon_link           text,
  web_view_link       text,
  size_bytes          bigint,
  added_by            uuid references public.users(id) on delete set null,
  added_at            timestamptz not null default now()
);

create index if not exists drive_files_subject_idx
  on public.drive_files (subject_type, subject_id);

create unique index if not exists drive_files_file_subject_unique
  on public.drive_files (file_id, subject_type, subject_id);

alter table public.drive_files enable row level security;

-- Lecture ouverte aux users authentifiés : les fichiers attachés à un
-- sujet sont visibles par toute l'équipe (le contenu Drive est de toute
-- façon protégé par les ACL Google). Mutations gérées côté app.
drop policy if exists "drive_files select all" on public.drive_files;
create policy "drive_files select all"
  on public.drive_files
  for select
  to authenticated
  using (true);
