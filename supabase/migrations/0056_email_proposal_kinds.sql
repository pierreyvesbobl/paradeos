-- Étend `email_proposal_kind` aux types entités CRM extraits par le LLM.
-- Calque sur meeting_proposals : on propose maintenant aussi la création
-- de contacts, entreprises et projets à partir du contenu des emails,
-- en plus des tâches / catégories / liens projet existants.
--
-- ALTER TYPE … ADD VALUE n'est pas réversible côté Postgres (pas de DROP
-- VALUE). En cas de rollback, le code applicatif doit cesser d'émettre
-- ces kinds avant que la migration suivante ne soit appliquée.

ALTER TYPE email_proposal_kind ADD VALUE IF NOT EXISTS 'contact';
ALTER TYPE email_proposal_kind ADD VALUE IF NOT EXISTS 'entity';
ALTER TYPE email_proposal_kind ADD VALUE IF NOT EXISTS 'project';
