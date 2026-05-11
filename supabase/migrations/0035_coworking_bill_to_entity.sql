-- Champ explicite "facturer au nom de" sur les contrats coworking.
--
-- Quand `bill_to_entity_id` est défini → facturation B2B au nom de
-- l'entité (typique : Webedia, Boots & Cats). Sinon → facturation B2C
-- au nom du contact (typique : coworkers individuels).
--
-- Le `contact_id` existant continue à indiquer **qui occupe** le poste.
-- Le nouveau champ indique **qui paie**.

alter table public.coworking_contracts
  add column bill_to_entity_id uuid
  references public.entities(id) on delete set null;

create index if not exists coworking_contracts_bill_to_entity_idx
  on public.coworking_contracts (bill_to_entity_id);

-- Backfill : pour chaque contrat existant dont le contact a une entité,
-- on présume que la facturation va sur l'entité.
update public.coworking_contracts cc
set bill_to_entity_id = c.entity_id
from public.contacts c
where cc.contact_id = c.id
  and c.entity_id is not null
  and cc.bill_to_entity_id is null;
