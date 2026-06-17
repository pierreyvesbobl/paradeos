ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "assignee_contact_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_contact_id_contacts_id_fk" FOREIGN KEY ("assignee_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_assignee_contact_idx" ON "tasks" ("assignee_contact_id");
