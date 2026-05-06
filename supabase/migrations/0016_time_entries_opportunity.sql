-- Permet de tracker le temps en avant-vente : un créneau peut être
-- rattaché à une opportunité (en plus / à la place du projet et de la
-- tâche). Une fois l'opportunité gagnée et convertie en projet, on
-- pourra agréger le temps avant-vente au projet via opportunities.project_id.

alter table public.time_entries
  add column if not exists opportunity_id uuid
  references public.opportunities(id) on delete set null;

create index if not exists time_entries_opportunity_idx
  on public.time_entries(opportunity_id);
