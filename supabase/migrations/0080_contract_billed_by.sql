-- =============================================================================
-- Qui encaisse : information portée par le contrat, plus seulement par la facture.
--
-- `invoices.billed_by` existait déjà (parade | g_and_o) et servait à exclure des
-- KPIs et des relances ce que Parade n'encaisse pas. Mais la génération
-- mensuelle écrivait `billed_by = 'parade'` **en dur** : la prochaine facture
-- d'un contrat encaissé par G&O — Webedia — serait donc marquée Parade, et
-- deviendrait éligible à un envoi que Parade n'a pas à faire.
--
-- C'est une propriété du contrat, pas de chaque facture : on la pose là, et la
-- génération en hérite.
--
-- Backfill depuis les factures existantes : un contrat dont une facture est
-- encaissée par G&O l'est pour tout le contrat.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

alter table public.coworking_contracts
  add column if not exists billed_by text not null default 'parade';

alter table public.coworking_contracts
  drop constraint if exists coworking_contracts_billed_by_check;
alter table public.coworking_contracts
  add constraint coworking_contracts_billed_by_check
  check (billed_by in ('parade', 'g_and_o'));

update public.coworking_contracts c
set billed_by = 'g_and_o'
where c.billed_by <> 'g_and_o'
  and exists (
    select 1 from public.invoices i
    where i.coworking_contract_id = c.id and i.billed_by = 'g_and_o'
  );

comment on column public.coworking_contracts.billed_by is
  'Qui encaisse les factures de ce contrat. ''g_and_o'' = ce n''est pas Parade qui facture : exclu des KPIs, des relances et de tout envoi.';
