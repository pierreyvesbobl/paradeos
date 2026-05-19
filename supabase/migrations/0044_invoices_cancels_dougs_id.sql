-- Pour les avoirs (kind=credit_note), on doit garder l'ID de la facture
-- Dougs annulée même quand la facture Paradeos correspondante n'existe
-- pas (cas où la facture Dougs n'a jamais eu de jalon/coworking côté
-- Paradeos) ou a été détachée par le cascade (cf. linkDougsCreditNote
-- qui clear dougs_invoice_id sur l'invoice annulée).
--
-- Sans cette colonne, on perdait la traçabilité visuelle ("cet avoir
-- annule quoi ?") dès que cancels_invoice_id était nul.

alter table public.invoices
  add column if not exists cancels_dougs_invoice_id text;

create index if not exists invoices_cancels_dougs_idx
  on public.invoices(cancels_dougs_invoice_id)
  where cancels_dougs_invoice_id is not null;
