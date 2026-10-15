-- =============================================================================
-- Créneaux « Claude Code » hérités de l'ancien modèle.
--
-- 0084 a retiré du réalisé les segments que le mod écrivait en time_entries
-- (source = claude_code)… mais une session ouverte avant le déploiement a
-- continué d'en pousser pendant deux jours (13 et 14/10), via l'ancien
-- serveur MCP : une vingtaine de créneaux sans projet, comptés dans le
-- réalisé, la marge et le TJM. Ce n'est pas ce qu'on veut.
--
-- On les convertit en signal (claude_code_activity) plutôt que de les
-- perdre : ils redeviennent des blocs « à imputer » dans /temps. Le segment
-- déjà présent côté signal (même source_ref) est conservé tel quel.
--
-- Depuis 0087, source = claude_code désigne un créneau IMPUTÉ par l'humain
-- depuis un bloc : ceux-là ont un segment qui pointe sur eux
-- (claude_code_activity.time_entry_id) et ne sont pas touchés.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

insert into public.claude_code_activity (user_id, started_at, ended_at, source_ref, remote, project_id)
select t.user_id, t.start_at, t.end_at, t.source_ref, null, t.project_id
from public.time_entries t
where t.source = 'claude_code'
  and t.source_ref is not null
  and not exists (
    select 1 from public.claude_code_activity a where a.time_entry_id = t.id
  )
on conflict (user_id, source_ref) do nothing;

delete from public.time_entries t
where t.source = 'claude_code'
  and not exists (
    select 1 from public.claude_code_activity a where a.time_entry_id = t.id
  );
