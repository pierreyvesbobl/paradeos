-- =============================================================================
-- La feuille de route du dépôt comme état d'avancement réel.
--
-- Le dépôt d'un projet peut porter un `roadmap.json` (épics, items
-- numérotés, statuts), tenu à jour par l'agent de code à chaque livraison.
-- Parade OS le lit (jamais ne l'écrit) et aligne ses tâches dessus.
--
-- 1. `project_repos.roadmap_path` : chemin du fichier dans le dépôt. NULL =
--    pas de feuille de route suivie sur ce dépôt.
--
-- 2. `repo_roadmaps` : dernier instantané lu (contenu, sha du blob), pour
--    afficher la feuille de route sans appeler GitHub à chaque rendu et pour
--    savoir si elle a changé depuis le dernier rapprochement.
--
-- 3. `task_roadmap_links` : tâche ↔ item. `suggested` (proposé par le LLM),
--    `confirmed` (validé par un humain : le statut de l'item pilote alors
--    celui de la tâche), `rejected` (cette paire ne sera plus proposée).
--    Une tâche n'a qu'un lien confirmé ; un item peut en avoir plusieurs
--    (deux tâches issues de deux réunions pour la même livraison).
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

alter table public.project_repos add column if not exists roadmap_path text;
comment on column public.project_repos.roadmap_path is
  'Chemin du roadmap.json dans le dépôt (lu par Parade OS, jamais écrit). NULL = pas de feuille de route suivie.';

update public.project_repos
   set roadmap_path = 'apps/web/src/data/roadmap.json'
 where remote = 'github.com/pierreyvesbobl/gpasplus-channel-health'
   and roadmap_path is null;

create table if not exists public.repo_roadmaps (
  remote      text primary key,
  path        text not null,
  sha         text,
  content     jsonb not null,
  fetched_at  timestamptz not null default now(),
  matched_at  timestamptz,
  matched_sha text,
  updated_at  timestamptz not null default now()
);

comment on table public.repo_roadmaps is
  'Dernier instantané du roadmap.json d''un dépôt suivi (lecture seule côté Parade OS).';
comment on column public.repo_roadmaps.matched_at is
  'Dernier rapprochement LLM tâches ↔ items ; relancé si la feuille de route ou les tâches ont bougé depuis.';

alter table public.repo_roadmaps enable row level security;
drop policy if exists "repo_roadmaps select all" on public.repo_roadmaps;
create policy "repo_roadmaps select all"
  on public.repo_roadmaps for select to authenticated using (true);
drop policy if exists paradeos_app_all on public.repo_roadmaps;
create policy paradeos_app_all on public.repo_roadmaps
  for all to paradeos_app using (true) with check (true);

create table if not exists public.task_roadmap_links (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  remote      text not null,
  item_id     text not null,
  status      text not null check (status in ('suggested', 'confirmed', 'rejected')),
  confidence  real,
  reason      text,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

create unique index if not exists task_roadmap_links_pair_unique
  on public.task_roadmap_links (task_id, remote, item_id);
create unique index if not exists task_roadmap_links_confirmed_unique
  on public.task_roadmap_links (task_id) where status = 'confirmed';
create index if not exists task_roadmap_links_remote_idx
  on public.task_roadmap_links (remote, item_id);

comment on table public.task_roadmap_links is
  'Rapprochement tâche Parade OS ↔ item de la feuille de route du dépôt (suggested / confirmed / rejected).';

alter table public.task_roadmap_links enable row level security;
drop policy if exists "task_roadmap_links select all" on public.task_roadmap_links;
create policy "task_roadmap_links select all"
  on public.task_roadmap_links for select to authenticated using (true);
drop policy if exists paradeos_app_all on public.task_roadmap_links;
create policy paradeos_app_all on public.task_roadmap_links
  for all to paradeos_app using (true) with check (true);
