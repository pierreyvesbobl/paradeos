-- Agent IA classement factures d'achat : audit log + idempotence.
-- Une ligne par PJ traitée. La paire (message_id, gmail_attachment_id)
-- est unique : un même PDF dans un même message n'est jamais reclassé
-- deux fois.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'invoice_filing_status') then
    create type invoice_filing_status as enum ('pending', 'filed', 'rejected', 'error');
  end if;
end $$;

create table if not exists public.invoice_filings (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.users(id) on delete cascade,
  message_id              uuid not null references public.gmail_messages(id) on delete cascade,
  gmail_attachment_id     text not null,
  original_filename       text,
  -- Métadonnées extraites par le LLM (utilisées pour nommer / ranger).
  invoice_date            date,
  supplier_raw            text,
  supplier_sanitized      text,
  prestation_type         text,
  confidence              numeric(4, 3),
  -- Résultat du classement.
  generated_filename      text,
  drive_year_folder_id    text,
  drive_supplier_folder_id text,
  drive_file_id           text,
  status                  invoice_filing_status not null default 'pending',
  error_message           text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint invoice_filings_message_attachment_unique unique (message_id, gmail_attachment_id)
);

create index if not exists invoice_filings_user_status_idx
  on public.invoice_filings (user_id, status, created_at desc);
create index if not exists invoice_filings_pending_idx
  on public.invoice_filings (user_id, created_at) where status = 'pending';

drop trigger if exists invoice_filings_touch_updated_at on public.invoice_filings;
create trigger invoice_filings_touch_updated_at
  before update on public.invoice_filings
  for each row execute function public.touch_updated_at();

alter table public.invoice_filings enable row level security;

drop policy if exists "invoice_filings select auth" on public.invoice_filings;
create policy "invoice_filings select auth"
  on public.invoice_filings for select to authenticated using (true);

drop policy if exists "invoice_filings insert auth" on public.invoice_filings;
create policy "invoice_filings insert auth"
  on public.invoice_filings for insert to authenticated with check (true);

drop policy if exists "invoice_filings update auth" on public.invoice_filings;
create policy "invoice_filings update auth"
  on public.invoice_filings for update to authenticated using (true) with check (true);

drop policy if exists "invoice_filings delete auth" on public.invoice_filings;
create policy "invoice_filings delete auth"
  on public.invoice_filings for delete to authenticated using (true);
