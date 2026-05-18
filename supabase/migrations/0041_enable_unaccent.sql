-- Active l'extension unaccent pour permettre la recherche
-- insensible aux accents (Bénédicte ↔ benedicte). Utilisée dans la
-- recherche /contacts et possiblement ailleurs.
--
-- Note Supabase : pg_trgm est déjà activée (cf migration 0003),
-- unaccent existe dans Postgres mais doit être créée explicitement.

create extension if not exists unaccent;
