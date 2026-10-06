-- Rôle applicatif dédié pour la connexion Drizzle (cf. lib/db/server.ts).
--
-- Aujourd'hui l'app se connecte en `postgres`, qui possède les tables, peut
-- faire du DDL, créer des rôles et bypasse la RLS. Sur Supabase, `postgres`
-- n'est pas superuser : impossible de créer un rôle BYPASSRLS. On donne donc
-- au rôle `paradeos_app` des policies permissives explicites sur chaque table
-- de `public` — même effet pour lui, RLS intacte pour anon/authenticated — et
-- rien d'autre : pas de DDL (PUBLIC n'a pas CREATE sur `public`), pas d'accès
-- aux schémas `auth` et `storage` (l'app y passe par l'API admin, cf.
-- lib/supabase/admin.ts), pas de création de rôle.
--
-- Créé NOLOGIN : il ne sert à rien tant qu'on ne lui a pas donné un mot de
-- passe et basculé DATABASE_URL sur Vercel (cf. README, « Rôle applicatif »).
-- Les migrations (DDL) continuent de passer par `postgres`.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'paradeos_app') then
    create role paradeos_app nologin;
  end if;
end
$$;

grant usage on schema public to paradeos_app;
grant select, insert, update, delete on all tables in schema public to paradeos_app;
grant usage, select on all sequences in schema public to paradeos_app;
grant execute on all functions in schema public to paradeos_app;

-- Les tables et séquences créées plus tard par `postgres` héritent des mêmes droits.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to paradeos_app;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to paradeos_app;
alter default privileges for role postgres in schema public
  grant execute on functions to paradeos_app;

-- Les policies, elles, n'ont pas de « default privileges » : cette fonction
-- les (re)pose sur toutes les tables de `public`. À rappeler à la fin de toute
-- migration qui crée une table : `select public.grant_paradeos_app();`
create or replace function public.grant_paradeos_app()
returns void
language plpgsql
as $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop policy if exists paradeos_app_all on public.%I', t.tablename);
    execute format(
      'create policy paradeos_app_all on public.%I for all to paradeos_app using (true) with check (true)',
      t.tablename
    );
  end loop;
end
$$;

select public.grant_paradeos_app();
