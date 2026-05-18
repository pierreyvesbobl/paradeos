-- Unification de toute la facturation sous une seule table `invoices`.
-- Avant : 3 modèles parallèles (billing_milestones JSONB sur projects,
-- table coworking_invoices, table dougs_credit_note_links + champs
-- dougs_quote_* sur projects).
-- Après : 1 table `invoices` avec un champ `kind` (quote | milestone |
-- coworking | one_off | credit_note), liens nullables vers project/
-- coworking_contract, snapshot Dougs unifié.
--
-- Migration en place : on copie l'ancien → nouveau, puis on drop l'ancien.
-- Idempotente sur la création (if not exists) ; le bloc de migration
-- des données est protégé par un test sur la présence des anciennes
-- colonnes pour pouvoir relancer le script sans erreur.

-- ---------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'invoice_kind') then
    create type invoice_kind as enum (
      'quote', 'milestone', 'coworking', 'one_off', 'credit_note'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'invoice_status') then
    create type invoice_status as enum (
      'draft', 'sent', 'accepted', 'refused', 'paid'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Table invoices
-- ---------------------------------------------------------------------

create table if not exists public.invoices (
  id                       uuid primary key default gen_random_uuid(),
  kind                     invoice_kind not null,

  -- Liens métier (nullable selon kind).
  project_id               uuid references public.projects(id) on delete set null,
  coworking_contract_id    uuid references public.coworking_contracts(id) on delete set null,
  cancels_invoice_id       uuid references public.invoices(id) on delete set null,

  -- Identité
  label                    text not null,
  reference                text,
  notes                    text,

  -- Montants
  amount_ht                numeric(12,2) not null default 0,
  vat_rate                 numeric(5,4) not null default 0.2,

  -- Cycle de vie unifié
  status                   invoice_status not null default 'draft',
  invoiced_at              timestamptz,
  paid_at                  timestamptz,

  -- Spec milestone (uniquement kind=milestone)
  milestone_type           text check (milestone_type in ('acompte','intermediaire','solde')),
  milestone_percent        integer,

  -- Spec coworking (uniquement kind=coworking)
  period_start             date,
  period_end               date,
  desks                    integer,
  unit_price_ht            numeric(10,2),
  billed_by                text check (billed_by in ('parade','g_and_o')),

  -- Snapshot Dougs (un seul jeu de colonnes, peu importe le kind)
  dougs_invoice_id         text,
  dougs_quote_id           text,
  dougs_reference          text,
  dougs_status             text,
  dougs_total_ht           numeric(12,2),
  dougs_total_vat          numeric(12,2),
  dougs_total_ttc          numeric(12,2),
  dougs_issued_at          timestamptz,
  dougs_paid_at            timestamptz,
  dougs_synced_at          timestamptz,

  -- Bookkeeping
  created_by               uuid references public.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists invoices_kind_idx on public.invoices(kind);
create index if not exists invoices_project_idx
  on public.invoices(project_id) where project_id is not null;
create index if not exists invoices_coworking_contract_idx
  on public.invoices(coworking_contract_id) where coworking_contract_id is not null;
create index if not exists invoices_status_idx on public.invoices(status);
create index if not exists invoices_dougs_invoice_idx
  on public.invoices(dougs_invoice_id) where dougs_invoice_id is not null;
create index if not exists invoices_dougs_quote_idx
  on public.invoices(dougs_quote_id) where dougs_quote_id is not null;
create index if not exists invoices_cancels_idx
  on public.invoices(cancels_invoice_id) where cancels_invoice_id is not null;

alter table public.invoices enable row level security;

drop policy if exists "invoices auth all" on public.invoices;
create policy "invoices auth all"
  on public.invoices
  for all
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------
-- 3. Migration des données — guard par existence des colonnes anciennes
--    (rejouable : si déjà drop, le bloc est skip).
-- ---------------------------------------------------------------------

-- 3a. projects.billing_milestones JSONB → invoices (kind=milestone)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'billing_milestones'
  ) then
    insert into public.invoices (
      id, kind, project_id, label, amount_ht, vat_rate, status,
      milestone_type, milestone_percent, invoiced_at, paid_at,
      dougs_invoice_id, dougs_reference, dougs_status,
      dougs_total_ht, dougs_total_vat, dougs_total_ttc,
      dougs_issued_at, dougs_paid_at, dougs_synced_at,
      created_at, updated_at
    )
    select
      (m->>'id')::uuid,
      'milestone'::invoice_kind,
      p.id,
      coalesce(m->>'label', '(jalon)'),
      coalesce((m->>'amountHt')::numeric, 0),
      coalesce((m->>'vatRate')::numeric, 0.2),
      case (m->>'status')
        when 'todo'     then 'draft'::invoice_status
        when 'invoiced' then 'sent'::invoice_status
        when 'paid'     then 'paid'::invoice_status
        else 'draft'::invoice_status
      end,
      m->>'type',
      nullif(m->>'percent','')::integer,
      nullif(m->>'invoicedAt','')::timestamptz,
      nullif(m->>'paidAt','')::timestamptz,
      nullif(m->>'dougsInvoiceId',''),
      nullif(m->>'dougsInvoiceReference',''),
      nullif(m->>'dougsStatus',''),
      nullif(m->>'dougsTotalHt','')::numeric,
      nullif(m->>'dougsTotalVat','')::numeric,
      nullif(m->>'dougsTotalTtc','')::numeric,
      nullif(m->>'dougsIssuedAt','')::timestamptz,
      -- dougs_paid_at hérité de paidAt si présent (pas distinct côté old)
      nullif(m->>'paidAt','')::timestamptz,
      nullif(m->>'dougsSyncedAt','')::timestamptz,
      coalesce(p.created_at, now()),
      coalesce(p.updated_at, now())
    from public.projects p
    cross join lateral jsonb_array_elements(coalesce(p.billing_milestones, '[]'::jsonb)) as m
    on conflict (id) do nothing;
  end if;
end $$;

-- 3b. projects.dougs_quote_* → invoices (kind=quote)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'dougs_quote_id'
  ) then
    insert into public.invoices (
      kind, project_id, label, amount_ht, vat_rate, status,
      reference,
      dougs_quote_id, dougs_reference, dougs_status,
      dougs_total_ht, dougs_total_vat, dougs_total_ttc,
      dougs_issued_at, dougs_synced_at,
      invoiced_at,
      created_at, updated_at
    )
    select
      'quote'::invoice_kind,
      p.id,
      'Devis ' || coalesce(p.name, ''),
      coalesce(p.dougs_quote_total_ht, p.value_amount, p.budget_amount, 0),
      0.2,
      case coalesce(upper(p.dougs_quote_status), '')
        when 'ACCEPTED' then 'accepted'::invoice_status
        when 'REFUSED'  then 'refused'::invoice_status
        when 'DRAFT'    then 'draft'::invoice_status
        else 'sent'::invoice_status -- PENDING etc.
      end,
      p.dougs_quote_reference,
      p.dougs_quote_id,
      p.dougs_quote_reference,
      p.dougs_quote_status,
      p.dougs_quote_total_ht,
      p.dougs_quote_total_vat,
      p.dougs_quote_total_ttc,
      p.dougs_quote_issued_at,
      p.dougs_quote_synced_at,
      p.dougs_quote_pushed_at,
      coalesce(p.created_at, now()),
      coalesce(p.updated_at, now())
    from public.projects p
    where p.dougs_quote_id is not null;
  end if;
end $$;

-- 3c. coworking_invoices → invoices (kind=coworking)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'coworking_invoices'
  ) then
    insert into public.invoices (
      id, kind, project_id, coworking_contract_id, label,
      amount_ht, vat_rate, status,
      period_start, period_end, desks, unit_price_ht, billed_by,
      invoiced_at, paid_at,
      dougs_invoice_id, dougs_reference, dougs_status,
      dougs_total_ht, dougs_total_vat, dougs_total_ttc,
      dougs_issued_at, dougs_paid_at, dougs_synced_at,
      notes, created_by, created_at, updated_at
    )
    select
      ci.id,
      'coworking'::invoice_kind,
      null,
      ci.contract_id,
      ci.name,
      (ci.unit_price_ht * ci.desks)::numeric(12,2),
      ci.vat_rate,
      case ci.status
        when 'a_facturer' then 'draft'::invoice_status
        when 'envoyee'    then 'sent'::invoice_status
        when 'payee'      then 'paid'::invoice_status
      end,
      ci.period_start,
      ci.period_end,
      ci.desks,
      ci.unit_price_ht,
      ci.billed_by::text,
      case when ci.invoice_date is not null then ci.invoice_date::timestamptz end,
      ci.dougs_invoice_paid_at,
      ci.dougs_invoice_id,
      ci.dougs_invoice_reference,
      ci.dougs_invoice_status,
      ci.dougs_invoice_total_ht,
      ci.dougs_invoice_total_vat,
      ci.dougs_invoice_total_ttc,
      ci.dougs_invoice_issued_at,
      ci.dougs_invoice_paid_at,
      ci.dougs_invoice_synced_at,
      ci.notes,
      ci.created_by,
      coalesce(ci.created_at, now()),
      coalesce(ci.updated_at, now())
    from public.coworking_invoices ci
    on conflict (id) do nothing;
  end if;
end $$;

-- 3d. dougs_credit_note_links → invoices (kind=credit_note) + cancels_invoice_id
--     L'avoir lui-même n'est PAS stocké comme invoice avant la migration
--     (il vit uniquement côté Dougs). On crée donc une invoice "stub"
--     kind=credit_note avec dougs_invoice_id = creditNoteId et un
--     cancels_invoice_id qui pointe vers la facture annulée (résolue
--     en cherchant l'invoice unifié avec dougs_invoice_id égal).
do $$
declare
  link record;
  cancelled_id uuid;
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'dougs_credit_note_links'
  ) then
    for link in
      select dougs_credit_note_id, cancels_dougs_invoice_id, created_by, created_at
      from public.dougs_credit_note_links
    loop
      -- Résoudre la facture annulée côté Paradeos (jalon ou coworking).
      select id into cancelled_id
      from public.invoices
      where dougs_invoice_id = link.cancels_dougs_invoice_id
      limit 1;

      insert into public.invoices (
        kind, label, amount_ht, status,
        dougs_invoice_id, cancels_invoice_id,
        created_by, created_at, updated_at
      )
      values (
        'credit_note'::invoice_kind,
        'Avoir Dougs ' || link.dougs_credit_note_id,
        0,
        'sent'::invoice_status,
        link.dougs_credit_note_id,
        cancelled_id, -- peut être NULL si la facture n'était pas liée à Paradeos
        link.created_by,
        link.created_at,
        link.created_at
      )
      on conflict do nothing;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Drop l'ancien
-- ---------------------------------------------------------------------

drop table if exists public.dougs_credit_note_links;
drop table if exists public.coworking_invoices;

alter table public.projects
  drop column if exists billing_milestones,
  drop column if exists dougs_quote_id,
  drop column if exists dougs_quote_reference,
  drop column if exists dougs_quote_status,
  drop column if exists dougs_quote_pushed_at,
  drop column if exists dougs_quote_total_ht,
  drop column if exists dougs_quote_total_ttc,
  drop column if exists dougs_quote_total_vat,
  drop column if exists dougs_quote_issued_at,
  drop column if exists dougs_quote_synced_at;

-- Les enums coworking_invoice_status / coworking_invoice_billed_by
-- ne sont plus utilisés. On les drop pour éviter le bruit côté pg.
drop type if exists coworking_invoice_status;
drop type if exists coworking_invoice_billed_by;
