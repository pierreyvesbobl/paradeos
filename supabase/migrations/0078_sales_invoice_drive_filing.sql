-- =============================================================================
-- Classement des factures de vente dans le Drive comptable.
--
-- Les factures d'achat sont déjà rangées automatiquement (cf. `invoice_filings`
-- et lib/gmail/invoice-filer.ts). Les factures de vente, elles, ne vivaient que
-- chez Dougs : rien n'en gardait copie dans l'arborescence comptable de Parade.
--
-- On ne crée pas de table : une facture de vente a déjà sa ligne dans
-- `invoices`, il suffit de tracer où son PDF a atterri. `drive_file_id` sert
-- aussi de verrou d'idempotence — on ne reclasse pas une facture déjà classée,
-- même si l'envoi est rejoué.
--
-- `drive_filing_error` garde la dernière raison d'échec. Un classement raté ne
-- doit jamais faire échouer l'envoi au client : la facture est partie, c'est ce
-- qui compte, la copie Drive se rattrape.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

alter table public.invoices
  add column if not exists drive_file_id text,
  add column if not exists drive_filed_at timestamptz,
  add column if not exists drive_filing_error text;

comment on column public.invoices.drive_file_id is
  'Id du PDF déposé dans le Drive comptable. Non nul = déjà classée, sert de verrou d''idempotence.';

-- File d'attente du classement : factures émises dont le PDF n'est pas encore
-- dans le Drive. Partielle, donc elle se vide à mesure.
create index if not exists invoices_drive_filing_queue_idx
  on public.invoices (invoiced_at)
  where drive_file_id is null and status in ('sent', 'paid');
