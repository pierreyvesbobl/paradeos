-- =============================================================================
-- Conditions de facturation par deal.
--
-- Avant : les conditions (modalités de paiement, échéance, mentions de pied,
-- note de bas de document) étaient figées par marque dans
-- `lib/billing/brand-templates.ts`. Suffisant pour le coworking, dont les
-- contrats sont homogènes ; faux pour la prestation, où chaque engagement se
-- négocie.
--
-- Après : une surcharge **éparse** par projet client et par contrat coworking.
-- Éparse est le mot important : on ne copie pas les défauts de la marque dans
-- chaque deal. Seules les clés réellement négociées sont stockées, donc un
-- changement de défaut au niveau marque continue d'atteindre tous les deals
-- qui n'ont rien surchargé.
--
-- Forme attendue (toutes les clés optionnelles) :
--   { paymentTerms?: string,
--     dueDateOption?: 'DAYS_15' | 'DAYS_30' | 'DAYS_60',
--     footerOthers?: string[],
--     thankYouNote?: string | null }
--
-- `dueDateOption` est volontairement une liste fermée : ce sont les seules
-- valeurs que l'API Dougs accepte (vérifié par sondage le 2026-10-05 ;
-- ON_RECEIPT, DAYS_7, DAYS_45 et END_OF_MONTH répondent 400). Elle pilote à la
-- fois l'échéance imprimée sur la facture et le délai que Parade OS suit pour
-- les relances — une seule source de vérité, pour que le document et le suivi
-- ne puissent pas se contredire.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

alter table public.projects
  add column if not exists billing_terms jsonb;

alter table public.coworking_contracts
  add column if not exists billing_terms jsonb;

comment on column public.projects.billing_terms is
  'Surcharge éparse des conditions de facturation de ce projet, par-dessus les défauts de la marque. Clé absente = on garde le défaut.';
comment on column public.coworking_contracts.billing_terms is
  'Surcharge éparse des conditions de facturation de ce contrat, par-dessus les défauts de la marque. Clé absente = on garde le défaut.';
