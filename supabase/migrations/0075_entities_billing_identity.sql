-- =============================================================================
-- Identité de facturation des entités : SIRET, raison sociale, adresse de
-- livraison.
--
-- Pourquoi maintenant : la facture électronique (réforme 2026-2027) est
-- entièrement déléguée à Dougs, qui reste l'émetteur légal — Parade OS
-- ne génère ni Factur-X, ni UBL, ni numéro. Mais Dougs ne peut produire une
-- facture conforme qu'avec des données complètes, et les trois chemins de push
-- envoyaient jusqu'ici `siret: null` en dur et une `deliveryAddress` faite de
-- quatre chaînes vides, alors que le SIREN seul ne suffit pas à router vers le
-- bon établissement destinataire.
--
-- `legal_name` est distinct de `name` : `name` est le nom d'usage affiché
-- partout dans le CRM, `legal_name` la dénomination sociale qui doit figurer
-- sur la facture.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

alter table public.entities
  add column if not exists siret text,
  add column if not exists legal_name text,
  add column if not exists delivery_address jsonb;

comment on column public.entities.siret is
  '14 chiffres. Identifiant d''établissement attendu par l''annuaire de la facturation électronique ; le SIREN seul ne suffit pas.';
comment on column public.entities.legal_name is
  'Dénomination sociale, si elle diffère du nom d''usage (`name`).';
comment on column public.entities.delivery_address is
  'Adresse de livraison {street, postalCode, city, country}, exigée par la facture électronique quand elle diffère de l''adresse de facturation.';
