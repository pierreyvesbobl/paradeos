-- =============================================================================
-- Rattachement automatique des réunions à un projet (cf.
-- lib/meetings/project-attach.ts)
--
--  - project_auto_at / project_auto_reason : quand et sur quels indices la
--    réunion a été rattachée sans clic. Garde anti-boucle : une réunion
--    visée une fois puis détachée à la main n'est plus jamais rattachée
--    d'office.
--  - project_auto_checked_at : dernière évaluation, pour que le rattrapage
--    ne réévalue pas toutes les réunions à chaque relève.
-- =============================================================================

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS project_auto_at timestamptz,
  ADD COLUMN IF NOT EXISTS project_auto_reason text,
  ADD COLUMN IF NOT EXISTS project_auto_checked_at timestamptz;
