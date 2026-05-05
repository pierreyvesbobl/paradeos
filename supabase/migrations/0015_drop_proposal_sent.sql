-- Fusion : 'proposal_sent' → 'awaiting_response' (sémantique proche
-- "on a envoyé quelque chose, on attend"). Puis retrait de la valeur
-- de l'enum opportunity_status.

-- 1. Migrer les opportunités existantes.
update public.opportunities
set status = 'awaiting_response'
where status = 'proposal_sent';

-- 2. Recréer l'enum sans 'proposal_sent'.
do $$
begin
  if exists (
    select 1 from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'opportunity_status' and e.enumlabel = 'proposal_sent'
  ) then
    alter type public.opportunity_status rename to opportunity_status_old;

    create type public.opportunity_status as enum (
      'not_started',
      'to_follow_up',
      'awaiting_response',
      'won',
      'lost'
    );

    -- Le default doit être détaché avant le changement de type.
    alter table public.opportunities alter column status drop default;
    alter table public.opportunities
      alter column status type public.opportunity_status
      using status::text::public.opportunity_status;
    alter table public.opportunities
      alter column status set default 'not_started'::public.opportunity_status;

    drop type public.opportunity_status_old;
  end if;
end $$;
