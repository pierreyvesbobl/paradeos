-- =============================================================================
-- Rapprochements dev validés sans clic.
--
-- Une suggestion tâche ↔ item de feuille de route ou tâche ↔ commit dont la
-- confiance atteint le seuil (réglage `DEV_AUTO_CONFIRM_MIN`, 0.9 par
-- défaut) est confirmée par la synchro elle-même. `auto` garde la trace :
-- l'onglet Développement le montre, et retirer le lien reste possible.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

alter table public.task_roadmap_links add column if not exists auto boolean not null default false;
comment on column public.task_roadmap_links.auto is
  'Confirmé par la synchro (confiance au-dessus du seuil), pas par un humain.';

alter table public.task_commit_links add column if not exists auto boolean not null default false;
comment on column public.task_commit_links.auto is
  'Confirmé par la synchro (confiance au-dessus du seuil), pas par un humain.';
