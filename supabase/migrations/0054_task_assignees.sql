-- =============================================================================
-- Multi-assignés — phase EXPAND.
--
-- (a) Crée la table de liaison `task_assignees` (kind=user|contact).
-- (b) Backfill depuis les colonnes legacy `tasks.assignee_id` /
--     `tasks.assignee_contact_id`.
-- (c) RLS + audit trigger.
-- (d) Trigger de sync legacy → nouveau, utile pendant la fenêtre où l'ancien
--     code mono-assigné continue d'écrire les colonnes legacy. Une fois le
--     refactor terminé, plus aucun chemin n'écrit `assignee_id` /
--     `assignee_contact_id`, donc le trigger reste dormant.
--
-- À la phase CONTRACT (0055, non appliquée tant que le code n'a pas été
-- déployé), on droppe le trigger ET les colonnes legacy en une fois.
-- =============================================================================

-- ---------- (a) Type + table ----------

DO $$ BEGIN
  CREATE TYPE public.task_assignee_kind AS ENUM ('user', 'contact');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PK = uuid synthétique. user_id / contact_id ne peuvent pas servir de PK
-- car PostgreSQL rendrait leurs colonnes NOT NULL ; or le CHECK XOR exige
-- l'un OU l'autre à NULL. Unicité applicative via 2 index partiels en
-- dessous : "une seule fois par (task, user)" et "une seule fois par
-- (task, contact)".
CREATE TABLE IF NOT EXISTS public.task_assignees (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL,
  kind       public.task_assignee_kind NOT NULL,
  user_id    uuid,
  contact_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid,
  CONSTRAINT task_assignees_kind_xor CHECK (
    (kind = 'user'    AND user_id    IS NOT NULL AND contact_id IS NULL)
    OR (kind = 'contact' AND contact_id IS NOT NULL AND user_id    IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS task_assignees_user_uniq
  ON public.task_assignees (task_id, user_id)
  WHERE kind = 'user';

CREATE UNIQUE INDEX IF NOT EXISTS task_assignees_contact_uniq
  ON public.task_assignees (task_id, contact_id)
  WHERE kind = 'contact';

DO $$ BEGIN
  ALTER TABLE public.task_assignees
    ADD CONSTRAINT task_assignees_task_id_tasks_id_fk
    FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.task_assignees
    ADD CONSTRAINT task_assignees_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.task_assignees
    ADD CONSTRAINT task_assignees_contact_id_contacts_id_fk
    FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.task_assignees
    ADD CONSTRAINT task_assignees_created_by_users_id_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS task_assignees_task_idx    ON public.task_assignees (task_id);
CREATE INDEX IF NOT EXISTS task_assignees_user_idx    ON public.task_assignees (user_id);
CREATE INDEX IF NOT EXISTS task_assignees_contact_idx ON public.task_assignees (contact_id);

-- ---------- (b) Backfill depuis colonnes legacy ----------

INSERT INTO public.task_assignees (task_id, kind, user_id, contact_id, created_at, created_by)
SELECT id, 'user', assignee_id, NULL, created_at, created_by
FROM public.tasks
WHERE assignee_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.task_assignees (task_id, kind, user_id, contact_id, created_at, created_by)
SELECT id, 'contact', NULL, assignee_contact_id, created_at, created_by
FROM public.tasks
WHERE assignee_contact_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ---------- (c) RLS + audit ----------

DROP TRIGGER IF EXISTS audit_log_task_assignees ON public.task_assignees;
CREATE TRIGGER audit_log_task_assignees
  AFTER INSERT OR UPDATE OR DELETE ON public.task_assignees
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_assignees_authenticated_select ON public.task_assignees;
CREATE POLICY task_assignees_authenticated_select ON public.task_assignees
  FOR SELECT USING (public.current_user_id() IS NOT NULL);

DROP POLICY IF EXISTS task_assignees_authenticated_insert ON public.task_assignees;
CREATE POLICY task_assignees_authenticated_insert ON public.task_assignees
  FOR INSERT WITH CHECK (public.current_user_id() IS NOT NULL);

DROP POLICY IF EXISTS task_assignees_authenticated_update ON public.task_assignees;
CREATE POLICY task_assignees_authenticated_update ON public.task_assignees
  FOR UPDATE USING (public.current_user_id() IS NOT NULL)
  WITH CHECK (public.current_user_id() IS NOT NULL);

DROP POLICY IF EXISTS task_assignees_authenticated_delete ON public.task_assignees;
CREATE POLICY task_assignees_authenticated_delete ON public.task_assignees
  FOR DELETE USING (public.current_user_id() IS NOT NULL);

-- ---------- (d) Trigger de sync legacy → nouveau ----------

CREATE OR REPLACE FUNCTION public.sync_task_assignees_from_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (tg_op = 'INSERT') OR
     (tg_op = 'UPDATE' AND new.assignee_id IS DISTINCT FROM old.assignee_id) THEN
    DELETE FROM public.task_assignees WHERE task_id = new.id AND kind = 'user';
    IF new.assignee_id IS NOT NULL THEN
      INSERT INTO public.task_assignees (task_id, kind, user_id, contact_id, created_by)
        VALUES (new.id, 'user', new.assignee_id, NULL, new.created_by)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF (tg_op = 'INSERT') OR
     (tg_op = 'UPDATE' AND new.assignee_contact_id IS DISTINCT FROM old.assignee_contact_id) THEN
    DELETE FROM public.task_assignees WHERE task_id = new.id AND kind = 'contact';
    IF new.assignee_contact_id IS NOT NULL THEN
      INSERT INTO public.task_assignees (task_id, kind, user_id, contact_id, created_by)
        VALUES (new.id, 'contact', NULL, new.assignee_contact_id, new.created_by)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS sync_task_assignees_from_legacy ON public.tasks;
CREATE TRIGGER sync_task_assignees_from_legacy
  AFTER INSERT OR UPDATE OF assignee_id, assignee_contact_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_task_assignees_from_legacy();
