-- =============================================================================
-- Envoi automatique des factures coworking.
--
-- Avant : le cron du 1er du mois crée la facture locale en `draft`, puis PY
-- pousse le brouillon sur Dougs à la main, puis finalise et envoie depuis l'UI
-- Dougs. Pour un flux dont le montant est entièrement déterminé par le contrat,
-- les deux derniers gestes ne portent aucune décision.
--
-- Après : opt-in explicite par contrat (`auto_send`), et traçabilité sur la
-- facture — `auto_sent_at` garantit l'idempotence du cron, `auto_send_error`
-- porte le dernier blocage renvoyé par `can-finalize` pour l'afficher dans l'UI
-- au lieu de réessayer en boucle en silence.
--
-- Le double verrou est volontaire : ce flag ne suffit pas, il faut aussi le
-- réglage global COWORKING_AUTOSEND_ENABLED dans app_settings. Aucun contrat
-- existant ne part automatiquement après cette migration.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

alter table public.coworking_contracts
  add column if not exists auto_send boolean not null default false;

alter table public.invoices
  add column if not exists auto_sent_at timestamptz,
  add column if not exists auto_send_error text;

-- La passe d'envoi du cron balaie les factures coworking encore en draft et
-- jamais envoyées automatiquement. Index partiel : la file est toujours petite
-- devant la table, et elle se vide à mesure que les factures passent en `sent`.
create index if not exists invoices_coworking_autosend_queue_idx
  on public.invoices (coworking_contract_id)
  where kind = 'coworking' and status = 'draft' and auto_sent_at is null;
