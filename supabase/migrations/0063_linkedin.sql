-- LinkedIn : conversations (DM), messages, rattachements et relations.
--
-- Paradeos n'appelle jamais LinkedIn. C'est l'extension Chrome qui
-- interroge l'API interne Voyager depuis le navigateur de l'utilisateur
-- (même IP, même session, même fingerprint) puis pousse le JSON
-- normalisé sur POST /api/linkedin/ingest. Aucun cookie `li_at` n'est
-- stocké : il ne quitte jamais la machine.
--
-- Idempotent : `pnpm db:supabase` rejoue tous les fichiers dans l'ordre.

do $$ begin
  create type linkedin_direction as enum ('in', 'out');
exception when duplicate_object then null; end $$;

do $$ begin
  create type linkedin_extraction_status as enum ('skipped', 'pending', 'extracted', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type linkedin_link_kind as enum ('project', 'contact', 'entity');
exception when duplicate_object then null; end $$;

do $$ begin
  create type linkedin_match_status as enum ('auto_merged', 'pending', 'created', 'ignored');
exception when duplicate_object then null; end $$;

do $$ begin
  create type linkedin_proposal_status as enum ('pending', 'accepted', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type linkedin_proposal_kind as enum
    ('task', 'contact', 'entity', 'project_link', 'entity_link');
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------
-- Tokens de synchro (extension Chrome → Paradeos)
-- ---------------------------------------------------------------------

create table if not exists public.linkedin_sync_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  label         text not null,
  token_hash    text not null,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists linkedin_sync_tokens_token_hash_unique
  on public.linkedin_sync_tokens (token_hash);
create index if not exists linkedin_sync_tokens_user_idx
  on public.linkedin_sync_tokens (user_id);

alter table public.linkedin_sync_tokens enable row level security;

drop policy if exists "linkedin_sync_tokens select auth" on public.linkedin_sync_tokens;
create policy "linkedin_sync_tokens select auth"
  on public.linkedin_sync_tokens for select to authenticated using (true);

drop policy if exists "linkedin_sync_tokens insert auth" on public.linkedin_sync_tokens;
create policy "linkedin_sync_tokens insert auth"
  on public.linkedin_sync_tokens for insert to authenticated with check (true);

drop policy if exists "linkedin_sync_tokens update auth" on public.linkedin_sync_tokens;
create policy "linkedin_sync_tokens update auth"
  on public.linkedin_sync_tokens for update to authenticated using (true) with check (true);

drop policy if exists "linkedin_sync_tokens delete auth" on public.linkedin_sync_tokens;
create policy "linkedin_sync_tokens delete auth"
  on public.linkedin_sync_tokens for delete to authenticated using (true);


-- ---------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------

create table if not exists public.linkedin_conversations (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  conversation_urn  text not null,
  title             text,
  participants      jsonb not null default '[]'::jsonb,
  last_message_at   timestamptz,
  snippet           text,
  message_count     int not null default 0,
  is_group          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint linkedin_conversations_user_urn_unique unique (user_id, conversation_urn)
);

create index if not exists linkedin_conversations_user_last_msg_idx
  on public.linkedin_conversations (user_id, last_message_at desc);
create index if not exists linkedin_conversations_participants_gin
  on public.linkedin_conversations using gin (participants jsonb_path_ops);

drop trigger if exists linkedin_conversations_touch_updated_at on public.linkedin_conversations;
create trigger linkedin_conversations_touch_updated_at
  before update on public.linkedin_conversations
  for each row execute function public.touch_updated_at();

alter table public.linkedin_conversations enable row level security;

drop policy if exists "linkedin_conversations select auth" on public.linkedin_conversations;
create policy "linkedin_conversations select auth"
  on public.linkedin_conversations for select to authenticated using (true);

drop policy if exists "linkedin_conversations insert auth" on public.linkedin_conversations;
create policy "linkedin_conversations insert auth"
  on public.linkedin_conversations for insert to authenticated with check (true);

drop policy if exists "linkedin_conversations update auth" on public.linkedin_conversations;
create policy "linkedin_conversations update auth"
  on public.linkedin_conversations for update to authenticated using (true) with check (true);

drop policy if exists "linkedin_conversations delete auth" on public.linkedin_conversations;
create policy "linkedin_conversations delete auth"
  on public.linkedin_conversations for delete to authenticated using (true);


-- ---------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------
-- `body_text` nullable : comme pour Gmail, on ne stocke le contenu que
-- si la conversation matche le CRM.

create table if not exists public.linkedin_messages (
  id                        uuid primary key default gen_random_uuid(),
  conversation_id           uuid not null references public.linkedin_conversations(id) on delete cascade,
  user_id                   uuid not null references public.users(id) on delete cascade,
  message_urn               text not null,
  sender_urn                text,
  sender_name               text,
  sender_public_identifier  text,
  direction                 linkedin_direction not null default 'in',
  body_text                 text,
  sent_at                   timestamptz,
  extraction_status         linkedin_extraction_status not null default 'skipped',
  extraction_meta           jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint linkedin_messages_user_urn_unique unique (user_id, message_urn)
);

create index if not exists linkedin_messages_conv_date_idx
  on public.linkedin_messages (conversation_id, sent_at desc);
create index if not exists linkedin_messages_pending_idx
  on public.linkedin_messages (extraction_status)
  where extraction_status in ('pending', 'failed');

drop trigger if exists linkedin_messages_touch_updated_at on public.linkedin_messages;
create trigger linkedin_messages_touch_updated_at
  before update on public.linkedin_messages
  for each row execute function public.touch_updated_at();

alter table public.linkedin_messages enable row level security;

drop policy if exists "linkedin_messages select auth" on public.linkedin_messages;
create policy "linkedin_messages select auth"
  on public.linkedin_messages for select to authenticated using (true);

drop policy if exists "linkedin_messages insert auth" on public.linkedin_messages;
create policy "linkedin_messages insert auth"
  on public.linkedin_messages for insert to authenticated with check (true);

drop policy if exists "linkedin_messages update auth" on public.linkedin_messages;
create policy "linkedin_messages update auth"
  on public.linkedin_messages for update to authenticated using (true) with check (true);

drop policy if exists "linkedin_messages delete auth" on public.linkedin_messages;
create policy "linkedin_messages delete auth"
  on public.linkedin_messages for delete to authenticated using (true);


-- ---------------------------------------------------------------------
-- Rattachements
-- ---------------------------------------------------------------------
-- On pointe directement le target CRM : l'indirection `gmail_tags`
-- n'existe que pour porter le libellé Gmail, que LinkedIn n'a pas.
-- La sémantique de décision est en revanche conservée telle quelle :
-- la ligne n'est jamais supprimée, `dismissed_at` scelle le refus et
-- bloque la repose automatique.

create table if not exists public.linkedin_conversation_links (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid not null references public.linkedin_conversations(id) on delete cascade,
  kind                  linkedin_link_kind not null,
  target_id             uuid not null,
  source                text not null default 'auto',
  manually_overridden   boolean not null default false,
  dismissed_at          timestamptz,
  decided_by            uuid references public.users(id) on delete set null,
  created_by            uuid references public.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint linkedin_conversation_links_unique unique (conversation_id, kind, target_id)
);

create index if not exists linkedin_conversation_links_conv_idx
  on public.linkedin_conversation_links (conversation_id);
create index if not exists linkedin_conversation_links_active_idx
  on public.linkedin_conversation_links (conversation_id)
  where dismissed_at is null;

alter table public.linkedin_conversation_links enable row level security;

drop policy if exists "linkedin_conversation_links select auth" on public.linkedin_conversation_links;
create policy "linkedin_conversation_links select auth"
  on public.linkedin_conversation_links for select to authenticated using (true);

drop policy if exists "linkedin_conversation_links insert auth" on public.linkedin_conversation_links;
create policy "linkedin_conversation_links insert auth"
  on public.linkedin_conversation_links for insert to authenticated with check (true);

drop policy if exists "linkedin_conversation_links update auth" on public.linkedin_conversation_links;
create policy "linkedin_conversation_links update auth"
  on public.linkedin_conversation_links for update to authenticated using (true) with check (true);

drop policy if exists "linkedin_conversation_links delete auth" on public.linkedin_conversation_links;
create policy "linkedin_conversation_links delete auth"
  on public.linkedin_conversation_links for delete to authenticated using (true);


-- ---------------------------------------------------------------------
-- Relations importées + file de rapprochement
-- ---------------------------------------------------------------------
-- Une seule table : une relation en `match_status='pending'` EST une
-- ligne de la file de rapprochement.

create table if not exists public.linkedin_connections (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  member_urn          text not null,
  public_identifier   text,
  first_name          text not null default '',
  last_name           text not null default '',
  headline            text,
  company             text,
  position            text,
  profile_url         text,
  email               text,
  connected_at        timestamptz,
  matched_contact_id  uuid references public.contacts(id) on delete set null,
  match_status        linkedin_match_status not null default 'pending',
  match_confidence    numeric(4,3),
  decided_by          uuid references public.users(id) on delete set null,
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint linkedin_connections_user_member_unique unique (user_id, member_urn)
);

create index if not exists linkedin_connections_status_idx
  on public.linkedin_connections (user_id, match_status);

drop trigger if exists linkedin_connections_touch_updated_at on public.linkedin_connections;
create trigger linkedin_connections_touch_updated_at
  before update on public.linkedin_connections
  for each row execute function public.touch_updated_at();

alter table public.linkedin_connections enable row level security;

drop policy if exists "linkedin_connections select auth" on public.linkedin_connections;
create policy "linkedin_connections select auth"
  on public.linkedin_connections for select to authenticated using (true);

drop policy if exists "linkedin_connections insert auth" on public.linkedin_connections;
create policy "linkedin_connections insert auth"
  on public.linkedin_connections for insert to authenticated with check (true);

drop policy if exists "linkedin_connections update auth" on public.linkedin_connections;
create policy "linkedin_connections update auth"
  on public.linkedin_connections for update to authenticated using (true) with check (true);

drop policy if exists "linkedin_connections delete auth" on public.linkedin_connections;
create policy "linkedin_connections delete auth"
  on public.linkedin_connections for delete to authenticated using (true);


-- ---------------------------------------------------------------------
-- État de synchro
-- ---------------------------------------------------------------------

create table if not exists public.linkedin_sync_state (
  user_id                     uuid primary key references public.users(id) on delete cascade,
  last_conversations_sync_at  timestamptz,
  last_connections_sync_at    timestamptz,
  conversations_cursor        text,
  last_error                  text,
  updated_at                  timestamptz not null default now()
);

drop trigger if exists linkedin_sync_state_touch_updated_at on public.linkedin_sync_state;
create trigger linkedin_sync_state_touch_updated_at
  before update on public.linkedin_sync_state
  for each row execute function public.touch_updated_at();

alter table public.linkedin_sync_state enable row level security;

drop policy if exists "linkedin_sync_state select auth" on public.linkedin_sync_state;
create policy "linkedin_sync_state select auth"
  on public.linkedin_sync_state for select to authenticated using (true);

drop policy if exists "linkedin_sync_state insert auth" on public.linkedin_sync_state;
create policy "linkedin_sync_state insert auth"
  on public.linkedin_sync_state for insert to authenticated with check (true);

drop policy if exists "linkedin_sync_state update auth" on public.linkedin_sync_state;
create policy "linkedin_sync_state update auth"
  on public.linkedin_sync_state for update to authenticated using (true) with check (true);

drop policy if exists "linkedin_sync_state delete auth" on public.linkedin_sync_state;
create policy "linkedin_sync_state delete auth"
  on public.linkedin_sync_state for delete to authenticated using (true);


-- ---------------------------------------------------------------------
-- Propositions (extractions LLM à valider dans l'inbox)
-- ---------------------------------------------------------------------

create table if not exists public.linkedin_proposals (
  id                  uuid primary key default gen_random_uuid(),
  message_id          uuid not null references public.linkedin_messages(id) on delete cascade,
  kind                linkedin_proposal_kind not null,
  payload             jsonb not null,
  matched_id          uuid,
  match_confidence    numeric(4,3),
  status              linkedin_proposal_status not null default 'pending',
  created_entity_id   uuid,
  decided_by          uuid references public.users(id) on delete set null,
  decided_at          timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists linkedin_proposals_message_idx
  on public.linkedin_proposals (message_id);

alter table public.linkedin_proposals enable row level security;

drop policy if exists "linkedin_proposals select auth" on public.linkedin_proposals;
create policy "linkedin_proposals select auth"
  on public.linkedin_proposals for select to authenticated using (true);

drop policy if exists "linkedin_proposals insert auth" on public.linkedin_proposals;
create policy "linkedin_proposals insert auth"
  on public.linkedin_proposals for insert to authenticated with check (true);

drop policy if exists "linkedin_proposals update auth" on public.linkedin_proposals;
create policy "linkedin_proposals update auth"
  on public.linkedin_proposals for update to authenticated using (true) with check (true);

drop policy if exists "linkedin_proposals delete auth" on public.linkedin_proposals;
create policy "linkedin_proposals delete auth"
  on public.linkedin_proposals for delete to authenticated using (true);
