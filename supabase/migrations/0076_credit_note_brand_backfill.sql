-- =============================================================================
-- Marque des avoirs : la faire suivre celle de la facture annulée.
--
-- La migration 0073 a backfillé les factures par `kind`, ce qui laissait les
-- avoirs sur le défaut `parade` alors qu'un avoir relève évidemment de la même
-- marque que la facture qu'il annule. Le code le fait déjà pour les nouveaux
-- (`cancelled?.brand` dans linkDougsCreditNote) ; il restait les anciens.
--
-- Les avoirs sans facture Paradeos correspondante (`cancels_invoice_id is
-- null`) restent sur `parade` : c'est le fourre-tout assumé, pas une erreur —
-- on n'a aucun moyen de deviner leur marque.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

update public.invoices cn
set brand = orig.brand
from public.invoices orig
where cn.kind = 'credit_note'
  and cn.cancels_invoice_id = orig.id
  and cn.brand <> orig.brand;
