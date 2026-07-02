-- =============================================================================
-- Ajoute une colonne JSONB `extraction_meta` sur `gmail_messages` pour stocker
-- la sortie non-actionnable de l'extraction LLM :
--
--   {
--     "summary":       "…",   -- résumé FR 2-3 phrases
--     "intent":        "request",
--     "pipelineStage": "opportunity",
--     "needsReply":    true
--   }
--
-- Alimenté par `lib/gmail/extract-and-save.ts` après chaque extraction réussie.
-- Utilisé par la vue thread (`app/(app)/emails/[threadId]`) pour afficher le
-- panneau d'extraction inline sans avoir à re-charger tout depuis les
-- propositions (qui elles portent uniquement les actions à valider).
-- =============================================================================

alter table public.gmail_messages
  add column if not exists extraction_meta jsonb;
