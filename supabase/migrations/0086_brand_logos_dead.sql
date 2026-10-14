-- =============================================================================
-- Logos de marque : purge des UUID morts.
--
-- Les trois logos téléversés le 2026-10-05 ont été remplacés chez Dougs (une
-- seule pièce `invoicingLogo` par société, chaque envoi écrase la précédente)
-- et répondent 404 depuis : image cassée sur toutes les factures. On efface
-- ces réglages pour que les documents reprennent le logo par défaut de la
-- société. Les valeurs sont nommées : rejouer la migration après un nouveau
-- réglage ne l'efface pas.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

delete from public.app_settings
where key in ('BRAND_LOGO_AUTOMATO', 'BRAND_LOGO_COWORKING', 'BRAND_LOGO_PARADE')
  and value in (
    '81de94df-83f6-4298-bf1d-5118efe2ba8c',
    '534ce244-b1f7-42e7-9c65-58e94714dcc2',
    '2170cb90-7f9b-4acf-bc81-8bae1f7b0ed6'
  );
