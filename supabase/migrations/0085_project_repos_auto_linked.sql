-- =============================================================================
-- Rattachement automatique des dépôts git.
--
-- Quand un dépôt inconnu pousse de l'activité Claude Code et qu'un seul
-- projet ouvert porte le même nom, on le rattache sans rien demander ;
-- en cas de doute, le signal reste « non rattaché » dans /temps où
-- l'humain choisit. `auto_linked` garde la trace du choix automatique,
-- pour l'afficher sur la fiche projet et le corriger d'un geste.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

alter table public.project_repos
  add column if not exists auto_linked boolean not null default false;

comment on column public.project_repos.auto_linked is
  'Vrai si le rattachement vient de l''affinité de nom (track_claude_time), faux si choisi par un humain.';
