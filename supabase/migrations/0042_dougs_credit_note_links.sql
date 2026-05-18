-- Lien avoir Dougs → facture Dougs qu'il annule. Une facture d'avoir
-- (totalNetAmount < 0 côté Dougs) annule tout ou partie d'une facture
-- précédente. On stocke cette relation côté Paradeos pour pouvoir, dans
-- la page rapprochement, classer les avoirs séparément des factures et
-- les rattacher à leur facture d'origine.
--
-- Une avoir = un seul lien (unique index). L'avoir non lié reste visible
-- dans la section dédiée tant que personne ne l'a attribué.

create table if not exists public.dougs_credit_note_links (
  id                          uuid primary key default gen_random_uuid(),
  dougs_credit_note_id        text not null,
  cancels_dougs_invoice_id    text not null,
  created_by                  uuid references public.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create unique index if not exists dougs_credit_note_links_cn_unique
  on public.dougs_credit_note_links (dougs_credit_note_id);

create index if not exists dougs_credit_note_links_invoice_idx
  on public.dougs_credit_note_links (cancels_dougs_invoice_id);

alter table public.dougs_credit_note_links enable row level security;

drop policy if exists "dougs_credit_note_links auth all" on public.dougs_credit_note_links;
create policy "dougs_credit_note_links auth all"
  on public.dougs_credit_note_links
  for all
  to authenticated
  using (true)
  with check (true);
