-- =============================================================================
-- Distinction facture d'ACHAT (fournisseur) vs facture de VENTE (émise par
-- Parade) sur les PJ détectées dans la boîte mail.
--
-- Avant : le LLM renvoyait un simple `isInvoice` booléen et les factures de
-- vente tombaient dans le même sac que les non-factures (status='rejected',
-- raison textuelle). Impossible de les retrouver ou de les taguer.
--
-- Après : une colonne `direction` porte la classification, et `customer_raw`
-- stocke le destinataire (client) pour les ventes, symétrique de
-- `supplier_raw` côté achats.
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'invoice_filing_direction') then
    create type invoice_filing_direction as enum ('purchase', 'sale', 'unknown');
  end if;
end $$;

alter table public.invoice_filings
  add column if not exists direction invoice_filing_direction not null default 'unknown',
  add column if not exists customer_raw text;

-- Backfill : tout ce qui a été classé dans Drive est par construction une
-- facture d'achat (le pipeline rejetait les ventes).
update public.invoice_filings
   set direction = 'purchase'
 where status = 'filed'
   and direction = 'unknown';

create index if not exists invoice_filings_user_direction_idx
  on public.invoice_filings (user_id, direction, created_at desc);
