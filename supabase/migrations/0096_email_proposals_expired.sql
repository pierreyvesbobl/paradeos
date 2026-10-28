-- =============================================================================
-- Propositions email périmées
--
-- Une proposition `pending` que personne n'a tranchée en 7 jours sort de la
-- file avec le statut `expired` (cf. lib/gmail/expire-proposals.ts), posé par
-- la relève Gmail. Distinct de `rejected` : ce n'est pas une décision, elle
-- n'apparaît pas dans l'historique, et une ré-extraction du message peut la
-- reposer.
--
-- ALTER TYPE … ADD VALUE n'est pas réversible côté Postgres (pas de DROP
-- VALUE). En cas de rollback, le code applicatif doit cesser d'émettre ce
-- statut avant que la migration suivante ne soit appliquée.
-- =============================================================================

ALTER TYPE email_proposal_status ADD VALUE IF NOT EXISTS 'expired';
