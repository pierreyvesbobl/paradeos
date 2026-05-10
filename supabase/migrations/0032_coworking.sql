-- Module coworking : qualification sur les contacts (pour distinguer
-- coworkers / clients / fournisseurs / etc), tables des contrats de
-- location de poste et factures associées.
--
-- Contrat = un coworker (ou plusieurs via JSON IDs) loue N postes sur
-- une période donnée à un prix HT. Facture = appel mensuel/périodique
-- contre un contrat, avec totaux calculés depuis le contrat.

-- 1. Qualification sur contacts ----------------------------------------

create type contact_qualification as enum (
  'lead',
  'client',
  'coworker',
  'partner',
  'supplier',
  'other'
);

alter table public.contacts
  add column qualification contact_qualification;

create index if not exists contacts_qualification_idx
  on public.contacts (qualification);

-- 2. Statuts contrats / factures ---------------------------------------

create type coworking_contract_status as enum ('en_cours', 'termine');

create type coworking_invoice_status as enum (
  'a_facturer',
  'envoyee',
  'payee'
);

create type coworking_invoice_billed_by as enum ('parade', 'g_and_o');

-- 3. Contrats ----------------------------------------------------------

create table if not exists public.coworking_contracts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  -- Coworker principal (FK directe). Si plusieurs coworkers sur un même
  -- contrat, on étend via une table coworking_contract_coworkers plus
  -- tard. Pour l'instant la majorité des contrats Parade sont mono-coworker.
  contact_id      uuid references public.contacts(id) on delete set null,
  start_date      date not null,
  end_date        date,
  desks           integer not null default 1,
  unit_price_ht   numeric(10, 2) not null default 0,
  status          coworking_contract_status not null default 'en_cours',
  notes           text,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists coworking_contracts_contact_idx
  on public.coworking_contracts (contact_id);
create index if not exists coworking_contracts_status_idx
  on public.coworking_contracts (status);

-- 4. Factures ----------------------------------------------------------

create table if not exists public.coworking_invoices (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid not null references public.coworking_contracts(id) on delete cascade,
  -- Numéro/nom interne (ex: "Facture COWORKER 2026-05"). Pas de notion
  -- de numéro légal ici — c'est Dougs qui le génère à la finalisation.
  name            text not null,
  invoice_date    date,
  period_start    date not null,
  period_end      date not null,
  status          coworking_invoice_status not null default 'a_facturer',
  billed_by       coworking_invoice_billed_by not null default 'parade',
  -- Snapshot au moment de l'émission (pour figer les montants même si
  -- le contrat évolue ensuite).
  desks           integer not null,
  unit_price_ht   numeric(10, 2) not null,
  vat_rate        numeric(5, 4) not null default 0.2,
  notes           text,
  -- Trace Dougs (à utiliser quand l'intégration sera branchée).
  dougs_invoice_id text,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists coworking_invoices_contract_idx
  on public.coworking_invoices (contract_id);
create index if not exists coworking_invoices_status_idx
  on public.coworking_invoices (status);
create index if not exists coworking_invoices_period_idx
  on public.coworking_invoices (period_start);

-- 5. RLS ---------------------------------------------------------------

alter table public.coworking_contracts enable row level security;
alter table public.coworking_invoices  enable row level security;

-- Multi-utilisateur : tout user authentifié de Parade voit/édite tous
-- les contrats/factures coworking. Si on segmente plus tard, on rajoute
-- des policies par owner_id.
drop policy if exists "coworking_contracts auth all" on public.coworking_contracts;
create policy "coworking_contracts auth all"
  on public.coworking_contracts
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "coworking_invoices auth all" on public.coworking_invoices;
create policy "coworking_invoices auth all"
  on public.coworking_invoices
  for all
  to authenticated
  using (true)
  with check (true);
