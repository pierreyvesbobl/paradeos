-- =============================================================================
-- Marques de Parade SAS sur les factures.
--
-- Parade SAS porte trois marques commerciales — Parade (divers), Coworking et
-- Automato (prestation client) — pour une seule entité juridique et un seul
-- `companyId` Dougs. Jusqu'ici l'activité n'était déductible qu'indirectement
-- via `invoices.kind` (cf. le `ComptaSegment` de app/(app)/compta, qui est un
-- pur filtre UI). Le contenu facturé étant codé en dur par kind, on ne pouvait
-- pas différencier libellés, mentions, mail d'accompagnement ni échéance.
--
-- Après : une dimension `brand` déclarée, qui sert de clé au registre de
-- templates de `lib/billing/brand-templates.ts`. Conformément au choix
-- d'architecture du README (« pas de table `brands` »), c'est un enum, pas une
-- table.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'invoice_brand') then
    create type invoice_brand as enum ('parade', 'coworking', 'automato');
  end if;
end $$;

alter table public.invoices
  add column if not exists brand invoice_brand not null default 'parade';

-- Backfill : les factures coworking et les devis/jalons projet (= prestation
-- client, donc Automato) sont déterministes. Les `one_off` et les avoirs
-- restent sur le défaut 'parade' et se corrigent à la main.
update public.invoices set brand = 'coworking'
  where kind = 'coworking' and brand = 'parade';

update public.invoices set brand = 'automato'
  where kind in ('quote', 'milestone') and brand = 'parade';

create index if not exists invoices_brand_idx on public.invoices (brand);
