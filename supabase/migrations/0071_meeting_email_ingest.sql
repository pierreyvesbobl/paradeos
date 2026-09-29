-- =============================================================================
-- Réunions ingérées depuis un mail.
--
-- Avant : un transcript entrait par l'UI (coller / uploader), par le watch
-- d'un dossier Drive, ou par MCP. Un transcript reçu ou transféré par mail
-- demandait de le télécharger puis de le re-uploader à la main.
--
-- Après : un label Gmail sert de file d'attente. Le cron lit les messages
-- qui le portent, crée la réunion depuis la PJ (texte, PDF ou audio) ou
-- depuis le corps du mail, puis retire le label.
--
-- `source_email_message_id` porte l'idempotence : un message donné ne peut
-- produire qu'une réunion, même si le label revient (rejeu, re-tag manuel).
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

alter table public.meetings
  add column if not exists source_email_message_id  text,
  add column if not exists source_email_from        text,
  add column if not exists source_email_received_at timestamptz;

create unique index if not exists meetings_source_email_message_unique
  on public.meetings (source_email_message_id)
  where source_email_message_id is not null;
