-- Adresse postale sur les contacts. Sert à facturer en B2C (au nom du
-- contact, sans entité) — le push Dougs a besoin d'une adresse pour
-- valider le brouillon. Mêmes clés que `entities.address`.

alter table public.contacts
  add column address jsonb;
