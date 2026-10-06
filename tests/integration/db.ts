import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";
import type { Database } from "@/db/client";
import { users } from "@/db/schema/users";
import * as schema from "./schema";

/**
 * Base Postgres embarquée (PGlite) pour les tests d'intégration : le schéma
 * Drizzle y est poussé tel quel, sans Docker ni Supabase local. Ce que ça
 * ne couvre pas, volontairement : la RLS, les triggers SQL et le schéma
 * `auth` (supabase/migrations) — la sécurité est enforcée côté app via
 * `action()`, c'est elle qu'on teste.
 *
 * Une instance par fichier de test (~1 s) : les tests d'un même fichier
 * partagent la base et doivent créer leurs propres lignes.
 */
export async function createTestDb(): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client) as unknown as Database;
  const { apply } = await pushSchema(schema, db);
  await apply();
  return { db, close: () => client.close() };
}

export type TestUser = { id: string; email: string; role: "admin" | "member" | "viewer" };

/** Insère un profil `users` (les Server Actions lisent le rôle dedans). */
export async function seedUser(
  db: Database,
  partial: Partial<TestUser> & { fullName?: string } = {},
): Promise<TestUser> {
  const user: TestUser = {
    id: partial.id ?? crypto.randomUUID(),
    email: partial.email ?? `${crypto.randomUUID().slice(0, 8)}@test.local`,
    role: partial.role ?? "member",
  };
  await db.insert(users).values({
    id: user.id,
    fullName: partial.fullName ?? user.email.split("@")[0],
    role: user.role,
  });
  return user;
}
