/**
 * Seed phase 0 : crée 3 users (PY admin + 2 placeholders) via l'API
 * admin Supabase. Idempotent : on cherche d'abord par e-mail, sinon
 * on invite (ce qui crée auth.users + déclenche le trigger
 * handle_new_user qui pose la ligne dans public.users).
 *
 * Usage : pnpm seed
 *   Variables requises : SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL, DATABASE_URL.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { users } from "../db/schema/users";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

type SeedUser = {
  email: string;
  fullName: string;
  role: "admin" | "member" | "viewer";
};

const SEED_USERS: SeedUser[] = [
  { email: "pierreyves@bobl.fr", fullName: "Pierre-Yves Sage", role: "admin" },
  { email: "benoit@parade.local", fullName: "Benoît Placeholder", role: "member" },
  { email: "benilde@parade.local", fullName: "Bénilde Placeholder", role: "member" },
];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

async function main() {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const dbUrl = requireEnv("DATABASE_URL");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const sqlClient = postgres(dbUrl, { prepare: false, max: 2 });
  const db = drizzle(sqlClient);

  console.info(`Seed : ${SEED_USERS.length} user(s)…`);

  for (const seed of SEED_USERS) {
    // 1) auth.users : trouver ou inviter.
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listErr) throw listErr;

    let authUser = list.users.find((u) => u.email?.toLowerCase() === seed.email.toLowerCase());

    if (!authUser) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(seed.email, {
        data: { full_name: seed.fullName },
      });
      if (error) {
        console.warn(`  ! invite KO pour ${seed.email}:`, error.message);
        continue;
      }
      authUser = data.user;
      console.info(`  ✓ invité : ${seed.email}`);
    } else {
      console.info(`  · existe déjà : ${seed.email}`);
    }

    if (!authUser) continue;

    // 2) public.users : upsert le rôle + nom (le trigger l'a peut-être déjà
    // créé en 'member', on s'assure du rôle attendu).
    await db
      .insert(users)
      .values({
        id: authUser.id,
        fullName: seed.fullName,
        role: seed.role,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { fullName: seed.fullName, role: seed.role },
      });

    console.info(`  ✓ profil sync (${seed.role}) : ${seed.email}`);
  }

  await sqlClient.end({ timeout: 5 });
  console.info("Seed terminé.");
}

main().catch((err) => {
  console.error("Seed échoué :", err);
  process.exit(1);
});
