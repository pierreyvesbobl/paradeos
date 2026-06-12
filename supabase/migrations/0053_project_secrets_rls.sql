-- RLS pour project_secrets (table créée via migration Drizzle 0010,
-- sans politique RLS — Supabase remontait une alerte critique
-- `rls_disabled_in_public`).
--
-- Les colonnes sensibles (value_enc, username_enc, notes_enc) sont déjà
-- chiffrées AES-256-GCM côté app (lib/crypto/secrets.ts, clé
-- SECRETS_ENC_KEY) — l'absence de RLS exposait quand même les enveloppes
-- chiffrées + labels + URLs aux clés `anon`/PostgREST publiques. On
-- aligne sur les autres tables projet : accès aux seuls utilisateurs
-- authentifiés.

alter table public.project_secrets enable row level security;

drop policy if exists "project_secrets select auth" on public.project_secrets;
create policy "project_secrets select auth"
  on public.project_secrets
  for select to authenticated using (true);

drop policy if exists "project_secrets insert auth" on public.project_secrets;
create policy "project_secrets insert auth"
  on public.project_secrets
  for insert to authenticated with check (true);

drop policy if exists "project_secrets update auth" on public.project_secrets;
create policy "project_secrets update auth"
  on public.project_secrets
  for update to authenticated using (true) with check (true);

drop policy if exists "project_secrets delete auth" on public.project_secrets;
create policy "project_secrets delete auth"
  on public.project_secrets
  for delete to authenticated using (true);
