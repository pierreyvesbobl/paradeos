-- Personal Access Tokens (PAT) pour l'API MCP HTTP. Format affiché
-- une seule fois à la création : `paradeos_pat_<random base64url>`.
-- Stocké en base sous forme de hash SHA-256 (token random à 32 bytes
-- → entropie suffisante pour ne pas avoir besoin de bcrypt).

create table if not exists public.user_api_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  label           text not null,
  token_hash      text not null,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);

create unique index if not exists user_api_tokens_token_hash_unique
  on public.user_api_tokens (token_hash);

create index if not exists user_api_tokens_user_idx
  on public.user_api_tokens (user_id);

alter table public.user_api_tokens enable row level security;

-- L'user voit ses propres tokens (sans la valeur en clair, qui n'est
-- jamais stockée). Création/révocation via les server actions.
drop policy if exists "user_api_tokens select own" on public.user_api_tokens;
create policy "user_api_tokens select own"
  on public.user_api_tokens
  for select
  to authenticated
  using (user_id = auth.uid());
