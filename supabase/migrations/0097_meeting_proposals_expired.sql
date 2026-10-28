-- =============================================================================
-- Propositions de réunion périmées
--
-- Même règle que 0096 pour les mails : une proposition `pending` que
-- personne n'a tranchée en 7 jours passe en `expired`
-- (cf. lib/crm/expire-proposals.ts), posé par la relève Gmail. Pas une
-- décision : absente de l'historique, reposable par ré-extraction.
--
-- ALTER TYPE … ADD VALUE n'est pas réversible côté Postgres.
-- =============================================================================

ALTER TYPE meeting_proposal_status ADD VALUE IF NOT EXISTS 'expired';
