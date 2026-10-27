-- =============================================================================
-- Du besoin client à l'issue GitHub : typage des tâches et projection.
--
-- 1. `tasks.kind` : ce qu'est la tâche, posé par l'extraction LLM puis
--    corrigeable à la main.
--      - feature       : quelque chose à développer dans un produit / dépôt ;
--      - investigation : vérifier, analyser, comprendre avant d'agir ;
--      - action        : geste humain (envoyer, demander, relancer, payer).
--    NULL = pas encore typée (tâches antérieures, saisie rapide).
--
-- 2. `project_repos.sync_issues` : le dépôt reçoit en issue GitHub les
--    tâches `feature` de son projet. Interrupteur par dépôt, éteint par
--    défaut : la projection est à sens unique (Parade OS possède titre et
--    brief, GitHub ne possède que la fermeture).
--
-- 3. `task_github_issues` : l'issue qui matérialise une tâche (une au
--    plus par tâche), avec l'empreinte du corps poussé pour ne réécrire
--    l'issue que si le brief a changé.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_kind') then
    create type public.task_kind as enum ('feature', 'investigation', 'action');
  end if;
end $$;

alter table public.tasks add column if not exists kind public.task_kind;
comment on column public.tasks.kind is
  'feature = à développer ; investigation = à analyser ; action = geste humain. NULL = non typée.';

alter table public.project_repos add column if not exists sync_issues boolean not null default false;
comment on column public.project_repos.sync_issues is
  'Le dépôt reçoit en issue GitHub les tâches feature de son projet (projection à sens unique).';

create table if not exists public.task_github_issues (
  task_id          uuid primary key references public.tasks(id) on delete cascade,
  remote           text not null,
  number           integer not null,
  url              text not null,
  body_fingerprint text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists task_github_issues_remote_number_unique
  on public.task_github_issues (remote, number);

comment on table public.task_github_issues is
  'Issue GitHub qui matérialise une tâche (projection Parade OS → GitHub, une issue au plus par tâche).';

alter table public.task_github_issues enable row level security;

drop policy if exists "task_github_issues select all" on public.task_github_issues;
create policy "task_github_issues select all"
  on public.task_github_issues
  for select to authenticated using (true);

-- Équivalent ciblé de grant_paradeos_app() pour la seule table nouvelle
-- (la fonction globale expire sur oauth_tokens, cf. 0083).
drop policy if exists paradeos_app_all on public.task_github_issues;
create policy paradeos_app_all on public.task_github_issues
  for all to paradeos_app using (true) with check (true);
