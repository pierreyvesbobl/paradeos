-- =============================================================================
-- Activité Claude Code : trace de l'imputation.
--
-- Un segment (ou un bloc de segments contigus) devient un créneau réalisé
-- quand l'humain le décide dans /temps. On garde le lien : le segment imputé
-- sort de la grille « à imputer », et si le créneau est supprimé, il y
-- revient (on delete set null). Le rapport sait ainsi dire combien du
-- signal a été tranché.
--
-- La colonne `remote` accueille aussi `local/<dossier>` pour les sessions
-- sans dépôt git (cf. lib/git/remote.ts) : même circuit de rattachement.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

alter table public.claude_code_activity
  add column if not exists time_entry_id uuid references public.time_entries(id) on delete set null;

create index if not exists claude_code_activity_time_entry_idx
  on public.claude_code_activity (time_entry_id);

comment on column public.claude_code_activity.time_entry_id is
  'Créneau réalisé créé à partir de ce segment (imputation humaine dans /temps). Null tant que le signal n''est pas tranché.';
comment on column public.claude_code_activity.remote is
  'Dépôt git normalisé de la session (cf. lib/git/remote.ts), ou local/<dossier> sans dépôt. Conservé même sans projet rattaché pour proposer le rattachement.';
comment on column public.time_entries.source is
  'Provenance du créneau : manual (saisie), calendar (event Google attribué) ou claude_code (imputé depuis un bloc d''activité Claude Code, cf. claude_code_activity.time_entry_id).';
