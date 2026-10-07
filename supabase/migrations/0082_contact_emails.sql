-- =============================================================================
-- Plusieurs adresses e-mail par contact.
--
-- Avant : `contacts.email`, une seule adresse. Une personne qui écrit depuis
-- sa boîte perso, ou depuis sa nouvelle société, n'était plus reconnue : la
-- sync Gmail ne téléchargeait pas ses mails, l'onglet E-mails de sa fiche
-- restait vide, et l'import LinkedIn ou une extraction de réunion proposait
-- un doublon.
--
-- Après : `contacts.email` reste l'adresse **principale** (affichée, triée,
-- destinataire des envois). Les autres vivent dans `contact_emails`. Tout ce
-- qui rapproche sur l'email regarde les deux (cf. lib/crm/contact-emails.ts).
--
-- Une adresse n'appartient qu'à un contact : index unique sur lower(email).
-- La collision avec une adresse principale est vérifiée côté app.
--
-- Idempotent : rejouable sans effet de bord (cf. scripts/apply-supabase-sql.ts).
-- =============================================================================

create table if not exists public.contact_emails (
  id         uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  email      text not null,
  label      text,
  created_at timestamptz not null default now()
);

create unique index if not exists contact_emails_email_lower_unique
  on public.contact_emails (lower(email));
create index if not exists contact_emails_contact_idx
  on public.contact_emails (contact_id);

comment on table public.contact_emails is
  'Adresses e-mail secondaires d''un contact. L''adresse principale reste contacts.email.';

alter table public.contact_emails enable row level security;

drop policy if exists "contact_emails select all" on public.contact_emails;
create policy "contact_emails select all"
  on public.contact_emails
  for select to authenticated using (true);

select public.grant_paradeos_app();
