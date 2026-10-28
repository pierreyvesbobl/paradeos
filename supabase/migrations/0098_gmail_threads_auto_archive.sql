-- =============================================================================
-- Archivage automatique des fils Gmail (cf. lib/gmail/auto-archive.ts)
--
-- Trace du geste posé par la relève : quand et pourquoi un fil a été retiré
-- de la boîte de réception. Sert aussi de garde anti-boucle : un fil remis
-- en boîte par l'utilisateur n'est pas ré-archivé tant qu'aucun message
-- plus récent n'arrive.
-- =============================================================================

ALTER TABLE gmail_threads
  ADD COLUMN IF NOT EXISTS auto_archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_archive_reason text;
