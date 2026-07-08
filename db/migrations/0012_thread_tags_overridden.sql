ALTER TABLE "gmail_thread_tags" ADD COLUMN IF NOT EXISTS "manually_overridden" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gmail_thread_tags_overridden_idx" ON "gmail_thread_tags" ("thread_id", "manually_overridden") WHERE "manually_overridden" = true;
