-- Jalons de facturation par projet (acompte / intermédiaire / solde).
-- JSONB simple — pas une nouvelle table parce qu'on n'a pas besoin de
-- requêter par jalon (toujours scoped à un projet) et la cardinalité
-- reste faible (typiquement 2-4 jalons).
--
-- Forme du JSON : array de
--   {
--     id: string (uuid),
--     type: 'acompte' | 'intermediaire' | 'solde',
--     label: string,
--     percent: number | null,         -- % du montant projet (ou null si saisi en €)
--     amountHt: number,                -- montant HT €
--     vatRate: number,                 -- 0.2 par défaut
--     status: 'todo' | 'invoiced' | 'paid',
--     dougsInvoiceId: string | null,
--     dougsInvoiceReference: string | null,
--     invoicedAt: string (ISO) | null,
--     paidAt: string (ISO) | null
--   }

alter table public.projects
  add column if not exists billing_milestones jsonb not null default '[]'::jsonb;
