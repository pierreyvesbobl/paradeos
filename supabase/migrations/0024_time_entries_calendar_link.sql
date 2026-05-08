-- Lien optionnel d'un time_entry vers un event Google Calendar.
-- Permet d'attribuer un event Google à un projet (clic dans /planning) :
-- on crée un time_entry kind=actual qui "mirror" l'event, le rattache au
-- projet, et le compte dans les stats projet. Le calendar_event source
-- reste en cache mais on le filtre de l'affichage quand il a un
-- time_entry attaché.
--
-- Snapshot only en v1 : pas de re-sync auto si l'event Google bouge
-- (start/end/title), l'utilisateur édite le time_entry à la main.

alter table public.time_entries
  add column if not exists google_event_id text,
  add column if not exists google_calendar_id uuid references public.google_calendars(id) on delete set null;

-- Un même event Google ne peut être attribué qu'à un seul time_entry
-- pour éviter les doublons. Index partiel : seulement quand la paire
-- est non-null (les time_entries normaux n'y sont pas soumis).
create unique index if not exists time_entries_google_event_unique
  on public.time_entries (google_calendar_id, google_event_id)
  where google_calendar_id is not null and google_event_id is not null;

create index if not exists time_entries_google_event_idx
  on public.time_entries (google_event_id)
  where google_event_id is not null;
