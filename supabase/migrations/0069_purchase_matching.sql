-- =============================================================================
-- Rapprochement automatisé des factures d'achat avec Dougs.
--
-- Avant : les PDF de factures fournisseurs sont classés dans le Drive par
-- `lib/gmail/invoice-filer.ts`, et les opérations bancaires vivent chez Dougs.
-- Personne ne rapproche les deux — c'est un rituel manuel mensuel.
--
-- Après : un inventaire du Drive (`purchase_documents`), un snapshot des
-- opérations Dougs (`dougs_operations`) et la table de leurs rapprochements
-- (`dougs_operation_matches`). Plus les montants sur `invoice_filings`, que
-- l'extraction LLM ne capturait pas alors que le TTC est le signal le plus
-- discriminant pour relier une facture à un débit.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

-- --------------------------------------------------------------------------
-- 1. Montants sur les factures déjà classées
-- --------------------------------------------------------------------------

alter table public.invoice_filings
  add column if not exists amount_ttc numeric(12,2),
  add column if not exists amount_ht numeric(12,2),
  add column if not exists vat_amount numeric(12,2),
  add column if not exists currency text,
  add column if not exists invoice_number text;

-- --------------------------------------------------------------------------
-- 2. Inventaire du Drive comptable
-- --------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'purchase_document_source') then
    create type purchase_document_source as enum ('parade_os', 'legacy');
  end if;
  if not exists (select 1 from pg_type where typname = 'purchase_extraction_status') then
    create type purchase_extraction_status as enum ('pending', 'done', 'failed', 'unparseable');
  end if;
end $$;

create table if not exists public.purchase_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  drive_file_id text not null,
  drive_file_name text not null,
  drive_md5 text,
  size_bytes integer,
  drive_created_at timestamptz,
  web_view_link text,

  supplier_label text,
  supplier_key text,
  invoice_date date,

  amount_ttc numeric(12,2),
  amount_ht numeric(12,2),
  vat_amount numeric(12,2),
  currency text,
  invoice_number text,

  source purchase_document_source not null default 'legacy',
  invoice_filing_id uuid references public.invoice_filings(id) on delete set null,

  extraction_status purchase_extraction_status not null default 'pending',
  extracted_at timestamptz,
  error_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Nombre de passages LLM déjà tentés. Un timeout réseau ne doit pas
-- condamner définitivement un document : on le remet en file, et on
-- n'abandonne qu'après `MAX_EXTRACTION_ATTEMPTS` essais.
alter table public.purchase_documents
  add column if not exists extraction_attempts integer not null default 0;

create unique index if not exists purchase_documents_drive_file_unique
  on public.purchase_documents (drive_file_id);
-- Pas de `user_id` en tête : l'inventaire décrit un dossier d'entreprise et
-- aucune requête ne filtre par utilisateur (cf. commentaire de la colonne).
drop index if exists purchase_documents_supplier_idx;
drop index if exists purchase_documents_amount_idx;
drop index if exists purchase_documents_extraction_idx;

create index if not exists purchase_documents_supplier_idx
  on public.purchase_documents (supplier_key, invoice_date);
create index if not exists purchase_documents_amount_idx
  on public.purchase_documents (amount_ttc);
-- File de backfill : on draine les plus anciens d'abord, jamais traités en tête.
create index if not exists purchase_documents_extraction_idx
  on public.purchase_documents (extraction_status, extracted_at nulls first);

-- --------------------------------------------------------------------------
-- 3. Snapshot des opérations bancaires Dougs
-- --------------------------------------------------------------------------

create table if not exists public.dougs_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,

  dougs_operation_id bigint not null,
  operation_date date,
  -- Montant signé tel que Dougs le renvoie : négatif = décaissement.
  amount numeric(12,2),
  wording text,
  is_inbound boolean,
  validated boolean not null default false,
  attachment_count integer not null default 0,
  synced_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists dougs_operations_operation_unique
  on public.dougs_operations (user_id, dougs_operation_id);
create index if not exists dougs_operations_orphan_idx
  on public.dougs_operations (user_id, attachment_count, operation_date);

-- --------------------------------------------------------------------------
-- 4. Rapprochements opération ↔ document
-- --------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'dougs_match_confidence') then
    create type dougs_match_confidence as enum ('certain', 'probable');
  end if;
  if not exists (select 1 from pg_type where typname = 'dougs_match_status') then
    create type dougs_match_status as enum ('suggested', 'attached', 'rejected', 'failed');
  end if;
end $$;

create table if not exists public.dougs_operation_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  operation_id uuid not null references public.dougs_operations(id) on delete cascade,
  document_id uuid not null references public.purchase_documents(id) on delete cascade,

  score numeric(4,3),
  score_breakdown jsonb,
  confidence dougs_match_confidence not null default 'probable',
  status dougs_match_status not null default 'suggested',

  dougs_attachment_id text,
  attached_at timestamptz,
  error_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unicité sur le COUPLE : une facture de loyer trimestrielle doit pouvoir
-- être attachée aux trois prélèvements mensuels qu'elle couvre.
create unique index if not exists dougs_operation_matches_pair_unique
  on public.dougs_operation_matches (operation_id, document_id);
create index if not exists dougs_operation_matches_queue_idx
  on public.dougs_operation_matches (user_id, status, score);

-- --------------------------------------------------------------------------
-- 5. updated_at automatique (trigger partagé, cf. migration 0052)
-- --------------------------------------------------------------------------

do $$ begin
  if exists (select 1 from pg_proc where proname = 'touch_updated_at') then
    drop trigger if exists purchase_documents_touch_updated_at on public.purchase_documents;
    create trigger purchase_documents_touch_updated_at
      before update on public.purchase_documents
      for each row execute function public.touch_updated_at();

    drop trigger if exists dougs_operations_touch_updated_at on public.dougs_operations;
    create trigger dougs_operations_touch_updated_at
      before update on public.dougs_operations
      for each row execute function public.touch_updated_at();

    drop trigger if exists dougs_operation_matches_touch_updated_at on public.dougs_operation_matches;
    create trigger dougs_operation_matches_touch_updated_at
      before update on public.dougs_operation_matches
      for each row execute function public.touch_updated_at();
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 6. RLS — même convention que les autres tables applicatives : accès
--    réservé aux sessions authentifiées, le filtrage par user_id est fait
--    dans le code (la connexion serveur `db()` passe outre les policies).
-- --------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['purchase_documents', 'dougs_operations', 'dougs_operation_matches']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s select auth" on public.%I', t, t);
    execute format(
      'create policy "%s select auth" on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists "%s insert auth" on public.%I', t, t);
    execute format(
      'create policy "%s insert auth" on public.%I for insert to authenticated with check (true)', t, t);
    execute format('drop policy if exists "%s update auth" on public.%I', t, t);
    execute format(
      'create policy "%s update auth" on public.%I for update to authenticated using (true) with check (true)', t, t);
    execute format('drop policy if exists "%s delete auth" on public.%I', t, t);
    execute format(
      'create policy "%s delete auth" on public.%I for delete to authenticated using (true)', t, t);
  end loop;
end $$;
