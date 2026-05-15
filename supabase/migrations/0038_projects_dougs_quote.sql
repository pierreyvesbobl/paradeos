-- Lien projet → devis Dougs. Permet de pousser un brouillon de devis
-- depuis la fiche projet, garder le lien pour re-push tant que pas
-- finalisé, et afficher un bouton "Ouvrir sur Dougs".
--
-- `dougs_quote_status` peut valoir DRAFT / PENDING / ACCEPTED / REFUSED
-- côté Dougs. Notre snapshot peut désynchro si l'user modifie côté Dougs
-- — on accepte cette divergence, on recharge à chaque action explicite.

alter table public.projects
  add column if not exists dougs_quote_id          text,
  add column if not exists dougs_quote_reference   text,
  add column if not exists dougs_quote_status      text,
  add column if not exists dougs_quote_pushed_at   timestamptz;
