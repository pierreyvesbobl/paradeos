CREATE TYPE "public"."note_kind" AS ENUM('memo', 'call', 'meeting', 'message');--> statement-breakpoint
CREATE TYPE "public"."note_subject_type" AS ENUM('entity', 'contact', 'opportunity', 'project', 'task');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"kind" "note_kind" DEFAULT 'memo' NOT NULL,
	"subject_type" "note_subject_type",
	"subject_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_subject_idx" ON "notes" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_author_idx" ON "notes" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_occurred_idx" ON "notes" USING btree ("occurred_at");