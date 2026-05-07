-- Étape 1/2 — étend l'enum `project_status` avec les valeurs commerciales.
-- PostgreSQL exige que ces valeurs soient commitées avant d'être utilisées
-- dans une mise à jour, donc on les ajoute dans une migration séparée
-- (la suite de la fusion est dans 0020_merge_opportunities_data.sql).

alter type project_status add value if not exists 'not_started' before 'planning';
alter type project_status add value if not exists 'to_follow_up' before 'planning';
alter type project_status add value if not exists 'awaiting_response' before 'planning';
alter type project_status add value if not exists 'won' before 'planning';
alter type project_status add value if not exists 'lost' before 'planning';
