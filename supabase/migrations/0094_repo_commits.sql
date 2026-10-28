-- =============================================================================
-- Ce que Claude Code fait vraiment : les commits des dépôts suivis.
--
-- Deux sources, même table : GitHub (relu toutes les quinze minutes pour les
-- dépôts avec feuille de route ou projection d'issues) et le mod Claude Code
-- (`report_commits`, dès qu'un commit est fait en session, poussé ou non).
-- Idempotent par (remote, sha).
--
-- `task_commit_links` : commit ↔ tâche Parade OS, proposé par le LLM
-- (`suggested`), tranché par un humain (`confirmed` = la tâche est livrée,
-- `rejected` = ne plus proposer la paire). `matched_at` sur le commit dit
-- que le rapprochement l'a examiné, pour ne pas y revenir.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

create table if not exists public.repo_commits (
  id            uuid primary key default gen_random_uuid(),
  remote        text not null,
  sha           text not null,
  subject       text not null,
  body          text,
  author        text,
  committed_at  timestamptz not null,
  url           text,
  source        text not null check (source in ('github', 'claude_code')),
  matched_at    timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists repo_commits_remote_sha_unique
  on public.repo_commits (remote, sha);
create index if not exists repo_commits_remote_date_idx
  on public.repo_commits (remote, committed_at desc);

comment on table public.repo_commits is
  'Commits des dépôts suivis (GitHub ou mod Claude Code), rapprochés des tâches.';

alter table public.repo_commits enable row level security;
drop policy if exists "repo_commits select all" on public.repo_commits;
create policy "repo_commits select all"
  on public.repo_commits for select to authenticated using (true);
drop policy if exists paradeos_app_all on public.repo_commits;
create policy paradeos_app_all on public.repo_commits
  for all to paradeos_app using (true) with check (true);

create table if not exists public.task_commit_links (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  remote      text not null,
  sha         text not null,
  status      text not null check (status in ('suggested', 'confirmed', 'rejected')),
  confidence  real,
  reason      text,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

create unique index if not exists task_commit_links_pair_unique
  on public.task_commit_links (task_id, remote, sha);
create index if not exists task_commit_links_commit_idx
  on public.task_commit_links (remote, sha);

comment on table public.task_commit_links is
  'Rapprochement commit ↔ tâche Parade OS (suggested / confirmed / rejected).';

alter table public.task_commit_links enable row level security;
drop policy if exists "task_commit_links select all" on public.task_commit_links;
create policy "task_commit_links select all"
  on public.task_commit_links for select to authenticated using (true);
drop policy if exists paradeos_app_all on public.task_commit_links;
create policy paradeos_app_all on public.task_commit_links
  for all to paradeos_app using (true) with check (true);
