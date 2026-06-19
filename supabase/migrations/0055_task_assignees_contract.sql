-- =============================================================================
-- Multi-assignés — phase CONTRACT.
--
-- ⚠️  Ne PAS appliquer tant que le code applicatif n'a pas été déployé en
-- production. Cette migration est destructive : elle supprime les colonnes
-- legacy `assignee_id` et `assignee_contact_id` sur `public.tasks`. Tout
-- code qui les lit / écrit encore tombera après application.
--
-- Pré-requis :
--   1. Le code applicatif n'écrit plus jamais ces colonnes (vérifier avec
--      `grep -rn 'assigneeId\\|assignee_id' lib/ app/ mcp-server/`).
--   2. La table `task_assignees` est en place et alimentée (cf. 0054).
--   3. Aucune query métier ne joint encore sur `assignee_id` /
--      `assignee_contact_id`.
--
-- Comment l'appliquer :
--   pnpm tsx scripts/apply-one-sql.ts supabase/migrations/0055_task_assignees_contract.sql
-- =============================================================================

-- 1. Drop le trigger de sync — il était utile pendant la fenêtre de
--    cohabitation. La table task_assignees est désormais la seule source
--    de vérité, plus rien n'écrit les colonnes legacy.
DROP TRIGGER IF EXISTS sync_task_assignees_from_legacy ON public.tasks;
DROP FUNCTION IF EXISTS public.sync_task_assignees_from_legacy();

-- 2. Drop les index legacy
DROP INDEX IF EXISTS public.tasks_assignee_idx;
DROP INDEX IF EXISTS public.tasks_assignee_contact_idx;

-- 3. Drop les colonnes legacy (cascade sur la FK)
ALTER TABLE public.tasks DROP COLUMN IF EXISTS assignee_id;
ALTER TABLE public.tasks DROP COLUMN IF EXISTS assignee_contact_id;
