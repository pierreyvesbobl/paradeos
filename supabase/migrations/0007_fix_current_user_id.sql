-- =============================================================================
-- Fix : `current_user_id()` plantait avec "invalid input syntax for type json"
-- quand `request.jwt.claims` était une chaîne vide (cas par défaut hors
-- transaction Supabase Auth).
--
-- La fonction est réécrite en plpgsql et ne lève plus jamais d'exception
-- même si les settings ne sont pas posés ou contiennent du JSON invalide.
--
-- Note : la propagation des claims JWT depuis l'app via `set_config(..., true)`
-- ne fonctionne pas avec le pool postgres-js (chaque execute = nouvelle
-- transaction), la fonction renverra donc NULL en pratique. La sécurité
-- est assurée côté application via `action()` + `requireUser()`. RLS reste
-- en place comme défense en profondeur (le rôle `postgres` la bypass).
-- =============================================================================

create or replace function public.current_user_id()
returns uuid
language plpgsql
stable
as $$
declare
  v_sub text;
  v_claims text;
begin
  -- Tentative directe : claim "sub" passé en setting.
  begin
    v_sub := nullif(current_setting('request.jwt.claim.sub', true), '');
  exception when others then
    v_sub := null;
  end;

  if v_sub is not null then
    begin
      return v_sub::uuid;
    exception when others then
      return null;
    end;
  end if;

  -- Fallback : claims JSON complets.
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '');
  exception when others then
    v_claims := null;
  end;

  if v_claims is not null then
    begin
      return (v_claims::jsonb ->> 'sub')::uuid;
    exception when others then
      return null;
    end;
  end if;

  return null;
end;
$$;
