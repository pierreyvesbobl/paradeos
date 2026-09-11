-- Verrou applicatif du sync Gmail : une seule synchronisation à la fois
-- par utilisateur (bouton « Sync now » vs cron). Expire après 10 min.
alter table public.gmail_sync_state
  add column if not exists sync_started_at timestamptz;

-- Une seule facture coworking par contrat et par période, même si le
-- bouton manuel et le cron du 1er du mois se croisent. On supprime
-- d'abord les doublons éventuels en gardant la plus ancienne.
delete from public.invoices i
using public.invoices j
where i.kind = 'coworking'
  and j.kind = 'coworking'
  and i.coworking_contract_id is not null
  and i.coworking_contract_id = j.coworking_contract_id
  and i.period_start = j.period_start
  and (i.created_at > j.created_at or (i.created_at = j.created_at and i.id > j.id));

create unique index if not exists invoices_coworking_period_uidx
  on public.invoices (coworking_contract_id, period_start)
  where kind = 'coworking' and coworking_contract_id is not null;
