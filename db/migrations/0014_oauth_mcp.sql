CREATE TABLE IF NOT EXISTS "oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_hash" text,
	"client_name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"grant_types" jsonb NOT NULL,
	"token_endpoint_auth_method" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_authorization_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scope" text NOT NULL,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_authorization_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"kind" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by" uuid,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_clients_created_idx" ON "oauth_clients" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_codes_expires_idx" ON "oauth_authorization_codes" ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_tokens_user_idx" ON "oauth_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_tokens_expires_idx" ON "oauth_tokens" ("expires_at");--> statement-breakpoint
-- RLS activée en défense en profondeur, comme sur le reste du schéma :
-- la connexion applicative utilise le rôle `postgres` qui la bypass, mais
-- ces tables ne doivent jamais être lisibles par une connexion anon/authenticated.
ALTER TABLE "oauth_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ENABLE ROW LEVEL SECURITY;
