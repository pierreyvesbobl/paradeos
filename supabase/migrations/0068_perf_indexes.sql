-- Rapport /temps : les agrégats globaux filtrent sur start_at seul, que
-- l'index composite (user_id, start_at) ne couvre pas → seq scan.
create index if not exists time_entries_start_idx on public.time_entries (start_at);

-- Liste /projets triée par updated_at desc.
create index if not exists projects_updated_at_idx on public.projects (updated_at);
