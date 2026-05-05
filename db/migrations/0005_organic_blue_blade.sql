CREATE TYPE "public"."project_billing_type" AS ENUM('none', 'fixed', 'hourly');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "billing_type" "project_billing_type" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "budget_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "hourly_rate" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cost_rate_hourly" numeric(8, 2);