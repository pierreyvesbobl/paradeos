-- Backfill : les projets internes (product/transverse) sans entité
-- sont rattachés à l'entité « Parade » (si elle existe). Cohérent avec
-- la règle d'auto-attribution à la création (cf. lib/actions/projects.ts).
--
-- Insensible à la casse pour tolérer "PARADE", "Parade", "parade".
-- No-op si aucune entité Parade n'est trouvée.

update public.projects
set entity_id = parade.id
from (
  select id from public.entities where lower(name) = 'parade' limit 1
) as parade
where (projects.kind = 'product' or projects.kind = 'transverse')
  and projects.entity_id is null;
