-- =============================================================================
-- Agent candidatures : réponse automatique « pas de poste ouvert ».
--
-- Les candidatures spontanées (stage, alternance, emploi) arrivent sur la
-- boîte sans jamais recevoir de réponse. Le sync Gmail les repère (sujet,
-- libellé), un appel LLM confirme que c'est bien une candidature, puis une
-- réponse part dans le fil, le fil reçoit le libellé Paradeos/Candidature
-- et quitte la boîte de réception.
--
-- Une ligne par message repéré ; une seule réponse par fil (une relance du
-- même candidat retombe en `rejected`, avec la raison).
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

do $$ begin
  create type public.candidature_reply_status as enum ('pending', 'replied', 'rejected', 'error');
exception when duplicate_object then null; end $$;

create table if not exists public.candidature_replies (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.users(id) on delete cascade,
  message_id             uuid not null references public.gmail_messages(id) on delete cascade,
  thread_id              uuid not null references public.gmail_threads(id) on delete cascade,
  candidate_email        text,
  candidate_name         text,
  status                 public.candidature_reply_status not null default 'pending',
  confidence             numeric(4,3),
  reason                 text,
  sent_gmail_message_id  text,
  error_message          text,
  replied_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists candidature_replies_message_unique
  on public.candidature_replies (message_id);
create index if not exists candidature_replies_user_status_idx
  on public.candidature_replies (user_id, status, created_at);
create index if not exists candidature_replies_thread_idx
  on public.candidature_replies (thread_id);

comment on table public.candidature_replies is
  'Journal de l''agent candidatures : mails repérés comme candidature, réponse automatique envoyée, fil libellé et archivé. Une réponse par fil au plus.';
comment on column public.candidature_replies.reason is
  'Résumé LLM de la candidature, ou raison du rejet (pas une candidature, fil déjà traité…).';

alter table public.candidature_replies enable row level security;

drop policy if exists "candidature_replies select all" on public.candidature_replies;
create policy "candidature_replies select all"
  on public.candidature_replies
  for select to authenticated using (true);

-- Équivalent ciblé de grant_paradeos_app() pour la seule table nouvelle : la
-- fonction globale attend un verrou sur oauth_tokens et expire (cf. 0083).
drop policy if exists paradeos_app_all on public.candidature_replies;
create policy paradeos_app_all on public.candidature_replies
  for all to paradeos_app using (true) with check (true);
