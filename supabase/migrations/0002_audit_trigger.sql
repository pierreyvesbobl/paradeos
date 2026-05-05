-- =============================================================================
-- Phase 0 — Trigger générique d'audit.
--
-- À attacher manuellement à chaque table qu'on veut auditer, via :
--   create trigger audit_log_<table>
--     after insert or update or delete on public.<table>
--     for each row execute function public.audit_log_trigger();
--
-- Le trigger est paramétrable (non utilisé ici) via TG_ARGV pour ignorer
-- des colonnes sensibles à l'avenir.
-- =============================================================================

create or replace function public.audit_log_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_user_id();
  v_row_id text;
  v_diff jsonb;
  v_action public.audit_action;
begin
  if (tg_op = 'INSERT') then
    v_action := 'insert';
    v_row_id := (to_jsonb(new) ->> 'id');
    v_diff := jsonb_build_object('after', to_jsonb(new));
  elsif (tg_op = 'UPDATE') then
    v_action := 'update';
    v_row_id := (to_jsonb(new) ->> 'id');
    v_diff := jsonb_build_object(
      'before', to_jsonb(old),
      'after', to_jsonb(new)
    );
  elsif (tg_op = 'DELETE') then
    v_action := 'delete';
    v_row_id := (to_jsonb(old) ->> 'id');
    v_diff := jsonb_build_object('before', to_jsonb(old));
  end if;

  insert into public.audit_log (user_id, action, table_name, row_id, diff)
  values (v_user_id, v_action, tg_table_name, v_row_id, v_diff);

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

-- Branchement sur les tables phase 0.
drop trigger if exists audit_log_users on public.users;
create trigger audit_log_users
  after insert or update or delete on public.users
  for each row execute function public.audit_log_trigger();

drop trigger if exists audit_log_tags on public.tags;
create trigger audit_log_tags
  after insert or update or delete on public.tags
  for each row execute function public.audit_log_trigger();

drop trigger if exists audit_log_taggings on public.taggings;
create trigger audit_log_taggings
  after insert or update or delete on public.taggings
  for each row execute function public.audit_log_trigger();
