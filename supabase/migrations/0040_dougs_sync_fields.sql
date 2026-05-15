-- Champs additionnels pour synchroniser l'état des ressources Dougs
-- (devis et factures) vers Paradeos, en plus de l'id + référence déjà
-- présents. Permet d'afficher dans Paradeos : statut Dougs, montants
-- recalculés côté serveur Dougs, date d'émission / paiement.

-- ---------- projects.dougs_quote_* (devis) ----------
alter table public.projects
  add column if not exists dougs_quote_total_ht        numeric(12,2),
  add column if not exists dougs_quote_total_ttc       numeric(12,2),
  add column if not exists dougs_quote_total_vat       numeric(12,2),
  add column if not exists dougs_quote_issued_at       timestamptz,
  add column if not exists dougs_quote_synced_at       timestamptz;

-- ---------- coworking_invoices ----------
alter table public.coworking_invoices
  add column if not exists dougs_invoice_reference   text,
  add column if not exists dougs_invoice_status      text,
  add column if not exists dougs_invoice_total_ht    numeric(12,2),
  add column if not exists dougs_invoice_total_ttc   numeric(12,2),
  add column if not exists dougs_invoice_total_vat   numeric(12,2),
  add column if not exists dougs_invoice_issued_at   timestamptz,
  add column if not exists dougs_invoice_paid_at     timestamptz,
  add column if not exists dougs_invoice_synced_at   timestamptz;

-- ---------- projects.billing_milestones (JSONB) ----------
-- Pas de migration SQL : on étend le shape côté app dans
-- BillingMilestone (db/schema/projects.ts). Les jalons existants
-- gardent leurs champs actuels (null pour les nouveaux).
-- Nouveaux champs JSONB par jalon :
--   dougsStatus, dougsTotalHt, dougsTotalTtc, dougsTotalVat,
--   dougsIssuedAt, dougsSyncedAt
