-- Date de début optionnelle pour permettre une vue Gantt et la
-- planification dans le temps. `due_date` reste la deadline.
-- Quand une seule des deux dates est définie, la vue Gantt traite
-- la tâche comme un créneau d'1 jour.
alter table public.tasks
  add column if not exists start_date date;
