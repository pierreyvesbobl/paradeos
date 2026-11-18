-- =============================================================================
-- Agent candidatures : réponse aussi aux offres de prestation.
--
-- Les freelances et agences qui proposent un renfort, de la sous-traitance
-- ou une « collaboration » suivent désormais le même chemin que les
-- candidatures (file, confirmation LLM, réponse type, libellé, archivage),
-- avec un second gabarit de réponse. La colonne `kind` garde ce que le LLM
-- a reconnu, pour l'affichage et les statistiques.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

alter table public.candidature_replies
  add column if not exists kind text
  check (kind in ('candidature', 'prestation'));

comment on column public.candidature_replies.kind is
  'Ce que le LLM a reconnu : candidature (emploi, stage, alternance) ou prestation (freelance, renfort, sous-traitance). Null tant qu''il n''a pas tranché.';

-- Les réponses déjà envoyées l'ont toutes été à des candidatures.
update public.candidature_replies
  set kind = 'candidature'
  where status = 'replied' and kind is null;
