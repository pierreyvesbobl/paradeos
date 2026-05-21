-- Phase 2 Gmail : propositions LLM extraites des emails matchés CRM.
-- Calque sur meeting_proposals : kind, payload JSONB, matched_id (FK
-- résolu par fuzzy match), status (pending/accepted/rejected).
--
-- Kind couverts :
--   - task            : tâche à créer (payload.title, dueDate, projectId, etc.)
--   - category_tag    : tag catégorie libre à appliquer ("Compta", "Annexe"…)
--   - project_link    : lier le thread à un projet inféré par le LLM
--                       (au-delà du contact match)

do $$ begin
  if not exists (select 1 from pg_type where typname = 'email_proposal_kind') then
    create type email_proposal_kind as enum ('task', 'category_tag', 'project_link');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'email_proposal_status') then
    create type email_proposal_status as enum ('pending', 'accepted', 'rejected');
  end if;
end $$;

create table if not exists public.email_proposals (
  id                uuid primary key default gen_random_uuid(),
  message_id        uuid not null references public.gmail_messages(id) on delete cascade,
  kind              email_proposal_kind not null,
  payload           jsonb not null,
  -- Pour project_link / category_tag : id du record CRM matché côté
  -- Paradeos (project / gmail_tag). Pour task : null (la tâche n'existe
  -- pas encore avant acceptation).
  matched_id        uuid,
  match_confidence  numeric(4, 3),
  status            email_proposal_status not null default 'pending',
  -- À l'acceptation : id de la ressource créée (task.id, gmail_tag.id, etc.).
  created_entity_id uuid,
  decided_by        uuid references public.users(id) on delete set null,
  decided_at        timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists email_proposals_message_idx on public.email_proposals (message_id);
create index if not exists email_proposals_status_idx on public.email_proposals (status)
  where status = 'pending';

alter table public.email_proposals enable row level security;

drop policy if exists "email_proposals select auth" on public.email_proposals;
create policy "email_proposals select auth"
  on public.email_proposals for select to authenticated using (true);

drop policy if exists "email_proposals insert auth" on public.email_proposals;
create policy "email_proposals insert auth"
  on public.email_proposals for insert to authenticated with check (true);

drop policy if exists "email_proposals update auth" on public.email_proposals;
create policy "email_proposals update auth"
  on public.email_proposals for update to authenticated using (true) with check (true);

drop policy if exists "email_proposals delete auth" on public.email_proposals;
create policy "email_proposals delete auth"
  on public.email_proposals for delete to authenticated using (true);
