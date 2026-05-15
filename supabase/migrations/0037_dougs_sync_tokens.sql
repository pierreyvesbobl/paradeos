-- Tokens scopés à la synchro du cookie Dougs depuis un bookmarklet.
-- Différents des PAT MCP (user_api_tokens) parce qu'ils ne donnent accès
-- qu'à un seul endpoint (POST /api/dougs/sync-cookie) — si un token fuite
-- depuis la barre de favoris d'un navigateur, le pire qu'on puisse faire
-- est d'écraser le cookie Dougs stocké pour ce user.
--
-- Format : `paradeos_dougs_sync_<base64url 32 bytes>`. Stocké en SHA-256.

create table if not exists public.dougs_sync_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  label           text not null,
  token_hash      text not null,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);

create unique index if not exists dougs_sync_tokens_token_hash_unique
  on public.dougs_sync_tokens (token_hash);

create index if not exists dougs_sync_tokens_user_idx
  on public.dougs_sync_tokens (user_id);

alter table public.dougs_sync_tokens enable row level security;

drop policy if exists "dougs_sync_tokens select own" on public.dougs_sync_tokens;
create policy "dougs_sync_tokens select own"
  on public.dougs_sync_tokens
  for select
  to authenticated
  using (user_id = auth.uid());
