/**
 * Génère un magic link Supabase sans passer par le SMTP. Bypass le rate
 * limit. Le lien expire au bout de 1 h.
 *
 * Usage : pnpm magic-link <email>
 *   ex. : pnpm magic-link pierreyves@bobl.fr
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage : pnpm magic-link <email>");
    process.exit(1);
  }

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (error) {
    console.error("Erreur :", error.message);
    process.exit(1);
  }

  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) {
    console.error("Pas de hashed_token retourné.");
    process.exit(1);
  }

  // Construit un lien qui passe par notre route /auth/confirm — flow PKCE
  // côté serveur, cookies posés via @supabase/ssr. Bypass le verify hosted
  // qui fait du implicit flow (tokens dans le hash fragment, invisible
  // côté serveur).
  const link = `${appUrl}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/`;

  console.info("\n✓ Magic link prêt (valable 1h) :\n");
  console.info(link);
  console.info("");
}

main().catch((err) => {
  console.error("Échec :", err);
  process.exit(1);
});
