-- =============================================================================
-- Propositions de clôture de tâche : kind `task_completion` sur les deux
-- tables de propositions (réunions et mails).
--
-- L'extraction LLM signale désormais les tâches ouvertes que le contenu
-- donne pour faites (« c'est envoyé », livrable reçu…). La proposition
-- porte la tâche visée dans `matched_id` ; l'accepter la passe en `done`,
-- l'annuler restaure le statut précédent.
--
-- Payload attendu :
--   {
--     "taskId":              "uuid",
--     "taskTitle":           "Envoyer le devis",
--     "projectId":           "uuid" | null,
--     "evidence":            "citation courte du passage",
--     "confidence":          "certain" | "probable",
--     "auto":                true | false,     -- clôturée sans clic humain
--     "previousStatus":      "todo" | …,       -- posés à l'acceptation
--     "previousCompletedAt": "iso" | null
--   }
--
-- ALTER TYPE … ADD VALUE n'est pas réversible côté Postgres (pas de DROP
-- VALUE). En cas de rollback, le code applicatif doit cesser d'émettre
-- ce kind avant que la migration suivante ne soit appliquée.
-- =============================================================================

ALTER TYPE meeting_proposal_kind ADD VALUE IF NOT EXISTS 'task_completion';
ALTER TYPE email_proposal_kind ADD VALUE IF NOT EXISTS 'task_completion';
