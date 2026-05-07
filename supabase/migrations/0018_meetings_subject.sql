-- Permet de rattacher un transcript de meeting à un projet OU une
-- opportunité. Mutuellement exclusifs côté app, pas de CHECK contraint
-- pour rester souple. set null on delete pour conserver le transcript
-- si la ressource liée est supprimée.

alter table public.meetings
  add column if not exists project_id uuid
  references public.projects(id) on delete set null;

alter table public.meetings
  add column if not exists opportunity_id uuid
  references public.opportunities(id) on delete set null;

create index if not exists meetings_project_idx
  on public.meetings(project_id);

create index if not exists meetings_opportunity_idx
  on public.meetings(opportunity_id);
