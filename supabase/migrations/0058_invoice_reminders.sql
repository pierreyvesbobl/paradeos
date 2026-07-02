-- =============================================================================
-- Invoices : suivi des factures à relancer.
--
-- 1. Ajoute `due_date` (échéance par facture, défaut à invoiced_at + 30j
--    posé côté applicatif lors du passage à status='sent').
-- 2. Ajoute `last_reminded_at` + `reminder_count` pour tracer les relances
--    et permettre d'afficher "Relancée le ... (#N)" dans la liste.
-- 3. Index partiel sur due_date filtré sur status='sent' (seul cas utile :
--    le listing des relances ne regarde que ces lignes).
-- 4. Backfill : aligne due_date sur l'heuristique 30j historiquement
--    utilisée par la home et le dashboard Compta.
--
-- Idempotent : `IF NOT EXISTS` partout, et le backfill ne touche pas les
-- lignes déjà renseignées (filtrage `where due_date is null`).
-- =============================================================================

alter table public.invoices
  add column if not exists due_date date,
  add column if not exists last_reminded_at timestamptz,
  add column if not exists reminder_count integer not null default 0;

create index if not exists invoices_due_date_idx
  on public.invoices (due_date)
  where status = 'sent';

update public.invoices
set due_date = (invoiced_at + interval '30 days')::date
where invoiced_at is not null
  and due_date is null
  and status in ('sent', 'paid');
