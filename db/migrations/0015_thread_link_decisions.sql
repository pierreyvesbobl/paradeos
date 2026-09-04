-- Le tagging des emails n'est plus une feature : c'est la projection des
-- décisions prises par l'utilisateur (lien projet/entité validé ou
-- invalidé) et des faits détectés (sens de facture). Cette migration
-- ajoute la décision négative, qui manquait : jusqu'ici détacher un
-- projet supprimait la ligne, donc la sync suivante pouvait le remettre.

ALTER TABLE "gmail_thread_tags" ADD COLUMN IF NOT EXISTS "dismissed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "gmail_thread_tags" ADD COLUMN IF NOT EXISTS "decided_by" uuid;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "gmail_thread_tags"
    ADD CONSTRAINT "gmail_thread_tags_decided_by_users_id_fk"
    FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- Les lectures de liaison filtrent toutes `dismissed_at is null`.
CREATE INDEX IF NOT EXISTS "gmail_thread_tags_active_idx"
  ON "gmail_thread_tags" ("thread_id") WHERE "dismissed_at" IS NULL;
--> statement-breakpoint
-- La taxonomie libre disparaît : plus de page de gestion, plus de
-- proposition `category_tag`. Les propositions encore en attente n'ont
-- plus de surface pour être traitées — on les clôt.
UPDATE "email_proposals" SET "status" = 'rejected', "decided_at" = now()
WHERE "kind" = 'category_tag' AND "status" = 'pending';
--> statement-breakpoint
-- Les catégories libres déjà créées restent en base (leur label Gmail
-- existe toujours côté Gmail) mais deviennent inertes : plus rien ne les
-- lit ni ne les applique. Seules les deux catégories système survivent
-- fonctionnellement.
--   Nettoyage optionnel, à jouer à la main si on veut aussi les purger :
--   DELETE FROM gmail_tags WHERE kind = 'category'
--     AND label_name NOT IN ('Paradeos/Facture achat', 'Paradeos/Facture vente');
