-- =============================================================================
-- Participants de réunion : un membre de l'équipe n'y figure qu'une fois.
--
-- L'extraction rattachait un membre de l'équipe à sa fiche contact homonyme
-- (il est aussi coworker, ou importé d'un carnet) quand le modèle recopiait
-- l'adresse de la fiche ; l'ajout manuel du même membre créait ensuite une
-- seconde ligne, les index uniques ne jouant qu'à l'intérieur d'un type.
-- Le code résout désormais l'équipe avant les contacts (cf.
-- lib/meetings/participants.ts) ; ici on reprend l'existant.
--
--   1. ligne contact homonyme ET ligne membre dans la même réunion → la
--      ligne contact disparaît ;
--   2. ligne contact homonyme seule → requalifiée en ligne membre.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

with team as (
  select c.id as contact_id, u.id as user_id
  from public.contacts c
  join public.users u
    on lower(trim(u.full_name)) = lower(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')))
)
delete from public.meeting_participants mp
using team t
where mp.contact_id = t.contact_id
  and exists (
    select 1 from public.meeting_participants x
    where x.meeting_id = mp.meeting_id and x.user_id = t.user_id
  );

with team as (
  select c.id as contact_id, u.id as user_id
  from public.contacts c
  join public.users u
    on lower(trim(u.full_name)) = lower(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')))
)
update public.meeting_participants mp
set contact_id = null, user_id = t.user_id
from team t
where mp.contact_id = t.contact_id;
