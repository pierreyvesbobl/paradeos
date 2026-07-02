-- =============================================================================
-- Invoices : responsable de la facturation/relance.
--
-- Ajoute `assigned_to` (uuid -> users) sur chaque facture. Par défaut, à la
-- création (et au passage à 'sent' via setInvoiceStatus), on copie
-- `projects.owner_id`. Pour les factures coworking sans projet, le champ
-- reste null jusqu'à assignation manuelle.
--
-- Backfill : pour toutes les factures liées à un projet, on initialise
-- `assigned_to` au `owner_id` du projet quand absent.
--
-- Idempotent : `IF NOT EXISTS` + backfill conditionnel.
-- =============================================================================

alter table public.invoices
  add column if not exists assigned_to uuid references public.users(id) on delete set null;

create index if not exists invoices_assigned_to_idx
  on public.invoices (assigned_to)
  where status = 'sent';

update public.invoices i
set assigned_to = p.owner_id
from public.projects p
where i.project_id = p.id
  and i.assigned_to is null
  and p.owner_id is not null;
