-- Indexes composites sur invoices pour les requêtes les plus fréquentes
-- du dashboard compta et des fiches projet/coworking.
--
-- Sans ces composites, Postgres peut choisir un scan sur le single-col
-- index `invoices_kind_idx` puis filtrer en mémoire — OK sur petite
-- table, mais on cadre dès maintenant pour ne pas se retrouver à
-- diagnostiquer plus tard.

create index if not exists invoices_kind_project_idx
  on public.invoices(kind, project_id)
  where project_id is not null;

create index if not exists invoices_kind_coworking_contract_idx
  on public.invoices(kind, coworking_contract_id)
  where coworking_contract_id is not null;

-- Dashboard compta filtre kind ∈ {milestone, coworking, one_off} et
-- exclut billed_by='g_and_o'. Composite (kind, billed_by) couvre ça.
create index if not exists invoices_kind_billed_by_idx
  on public.invoices(kind, billed_by);

-- Liste des factures en attente (dashboard) : status='draft'|'sent'.
-- L'index single sur status couvre déjà mais on ajoute un composite
-- avec kind pour éviter le filtre kind en mémoire.
create index if not exists invoices_kind_status_idx
  on public.invoices(kind, status);
