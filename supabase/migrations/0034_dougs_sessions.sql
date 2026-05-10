-- Stockage chiffré du cookie de session Dougs par user. Permet à
-- Paradeos de pousser des brouillons de facture (et autres opérations
-- read/write) vers app.dougs.fr sans demander à l'user de re-coller
-- son cookie à chaque action.
--
-- Le cookie est chiffré AES-256-GCM avec DOUGS_ENCRYPTION_KEY (cf.
-- lib/dougs/crypto.ts). Durée de vie ~24h côté Dougs ; on tente
-- d'utiliser la session, et si on a un 401, l'app indique à l'user
-- d'aller refresh dans /settings/integrations.

create table if not exists public.dougs_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  -- Cookie chiffré au format `iv:tag:ciphertext` (hex). Voir crypto.ts.
  cookie_encrypted  text not null,
  -- companyId Dougs (Parade SAS = 107610). Configurable au cas où.
  company_id        text not null default '107610',
  last_used_at      timestamptz,
  -- Expiration estimée (24h après création/update). Indicatif.
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists dougs_sessions_user_unique
  on public.dougs_sessions (user_id);

alter table public.dougs_sessions enable row level security;

-- Chaque user voit/édite uniquement sa propre session Dougs.
drop policy if exists "dougs_sessions own" on public.dougs_sessions;
create policy "dougs_sessions own"
  on public.dougs_sessions
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Trigger updated_at standard.
drop trigger if exists dougs_sessions_touch_updated_at on public.dougs_sessions;
create trigger dougs_sessions_touch_updated_at
  before update on public.dougs_sessions
  for each row execute function public.touch_updated_at();
