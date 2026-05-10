-- Cadence de facturation pour les contrats coworking. Sert à
-- auto-générer la facture suivante avec la période correcte.
-- Default 'quarterly' parce que historiquement la majorité des
-- contrats Parade tournent en trimestriel (T1/T2/T3/T4).

create type coworking_billing_frequency as enum ('monthly', 'quarterly');

alter table public.coworking_contracts
  add column billing_frequency coworking_billing_frequency not null default 'quarterly';
