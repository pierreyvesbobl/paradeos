-- =============================================================================
-- Aperçu obligatoire avant envoi d'un document client.
--
-- Avant : l'envoi d'un devis ou d'une facture au client exigeait une
-- confirmation, mais seulement déclarative. Dans l'UI c'était un second clic ;
-- via MCP, un agent pouvait poser `confirm: true` du premier coup, sans que
-- personne n'ait jamais vu ce qui partait.
--
-- Après : l'envoi est refusé tant qu'un aperçu n'a pas été expédié **pour ce
-- document et pour ce message précis**. `preview_digest` est l'empreinte de
-- l'objet et du corps : si le message change après l'aperçu, la garde retombe,
-- parce que personne n'a relu ce que le client recevra.
--
-- Ne concerne pas les factures envoyées automatiquement (coworking) : personne
-- n'y rédige de message, donc il n'y a rien à relire. Elles passent par
-- `lib/coworking/auto-send.ts`, qui a ses propres verrous.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

alter table public.invoices
  add column if not exists preview_sent_at timestamptz,
  add column if not exists preview_digest text;

comment on column public.invoices.preview_digest is
  'Empreinte SHA-256 de l''objet et du corps du dernier aperçu envoyé. L''envoi au client exige qu''elle corresponde au message soumis.';
