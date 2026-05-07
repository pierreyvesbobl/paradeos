-- Étape 2/2 — finalise la fusion opportunities → projects.
--
-- Ordre :
--   1. Étend la table `projects` avec les champs commerciaux + contact_id
--   2. Migre la data des opportunities vers projects
--   3. Remappe les FKs polymorphes (notes / meetings / time_entries)
--   4. Drop les colonnes/tables obsolètes
--
-- Idempotent : `add column if not exists` partout.
-- L'enum `project_status` a déjà été étendu en 0019.

-- ───────────────────────────────────────────────────────────────────
-- 1. Étendre projects
-- ───────────────────────────────────────────────────────────────────

alter table public.projects
  add column if not exists contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists value_amount numeric(12, 2),
  add column if not exists probability integer,
  add column if not exists source text,
  add column if not exists first_contact_date date,
  add column if not exists last_contact_date date,
  add column if not exists follow_up_date date,
  add column if not exists expected_close_date date;

create index if not exists projects_contact_idx on public.projects(contact_id);
create index if not exists projects_follow_up_idx on public.projects(follow_up_date);

-- ───────────────────────────────────────────────────────────────────
-- 2. Migrer les opportunities vers projects
-- ───────────────────────────────────────────────────────────────────

create table if not exists _opp_to_project_mapping (
  opp_id uuid primary key,
  project_id uuid not null
);

-- a) Opps converties (project_id non null) : copie des champs si encore vides côté project.
insert into _opp_to_project_mapping (opp_id, project_id)
select o.id, o.project_id
from public.opportunities o
where o.project_id is not null
on conflict (opp_id) do nothing;

update public.projects p
set
  value_amount = coalesce(p.value_amount, o.value_amount),
  probability = coalesce(p.probability, o.probability),
  source = coalesce(p.source, o.source),
  first_contact_date = coalesce(p.first_contact_date, o.first_contact_date),
  last_contact_date = coalesce(p.last_contact_date, o.last_contact_date),
  follow_up_date = coalesce(p.follow_up_date, o.follow_up_date),
  expected_close_date = coalesce(p.expected_close_date, o.expected_close_date),
  contact_id = coalesce(p.contact_id, o.contact_id)
from public.opportunities o
where o.project_id = p.id;

-- b) Opps non converties : on crée un project (kind=client par défaut).
--    Le statut commercial de l'opp devient le statut du project.
with new_projects as (
  insert into public.projects (
    name, kind, status, entity_id, contact_id, description,
    value_amount, probability, source,
    first_contact_date, last_contact_date, follow_up_date, expected_close_date,
    owner_id, created_by, created_at, updated_at
  )
  select
    o.title, 'client', o.status::text::project_status, o.entity_id, o.contact_id, o.notes,
    o.value_amount, o.probability, o.source,
    o.first_contact_date, o.last_contact_date, o.follow_up_date, o.expected_close_date,
    o.owner_id, o.created_by, o.created_at, o.updated_at
  from public.opportunities o
  where o.project_id is null
  returning id, name, created_at
)
insert into _opp_to_project_mapping (opp_id, project_id)
select o.id, np.id
from public.opportunities o
join new_projects np on np.name = o.title and np.created_at = o.created_at
where o.project_id is null
on conflict (opp_id) do nothing;

-- ───────────────────────────────────────────────────────────────────
-- 3. Remap des FKs polymorphes
-- ───────────────────────────────────────────────────────────────────

-- 3.a Notes : subjectType=opportunity → project, subjectId remappé.
update public.notes n
set subject_type = 'project', subject_id = m.project_id
from _opp_to_project_mapping m
where n.subject_type = 'opportunity' and n.subject_id = m.opp_id;

-- 3.b Meetings : opportunityId → projectId (si pas déjà set).
update public.meetings me
set project_id = m.project_id, opportunity_id = null
from _opp_to_project_mapping m
where me.opportunity_id = m.opp_id and me.project_id is null;

-- Pour les meetings qui avaient déjà un projectId ET un opportunityId
-- (cas rare), on garde le projectId et clear l'opportunityId.
update public.meetings
set opportunity_id = null
where opportunity_id is not null;

-- 3.c Time entries : opportunityId → projectId (si pas déjà set).
update public.time_entries te
set project_id = m.project_id, opportunity_id = null
from _opp_to_project_mapping m
where te.opportunity_id = m.opp_id and te.project_id is null;

update public.time_entries
set opportunity_id = null
where opportunity_id is not null;

-- ───────────────────────────────────────────────────────────────────
-- 4. Drop des structures obsolètes
-- ───────────────────────────────────────────────────────────────────

alter table public.meetings drop column if exists opportunity_id;
alter table public.time_entries drop column if exists opportunity_id;

drop table if exists public.opportunities cascade;
drop type if exists opportunity_status;

drop table if exists _opp_to_project_mapping;
