-- Durcissement sécurité (cf. lib/actions/project-secrets.ts, app/api/oauth/register).

-- Trace des consultations en clair des secrets projets.
alter table public.project_secrets
  add column if not exists reveal_count integer not null default 0,
  add column if not exists last_revealed_at timestamptz,
  add column if not exists last_revealed_by uuid references public.users(id) on delete set null;

-- IP d'enregistrement des clients OAuth/MCP, pour le plafond par IP.
alter table public.oauth_clients
  add column if not exists registered_ip text;

create index if not exists oauth_clients_created_ip_idx
  on public.oauth_clients (created_at, registered_ip);
