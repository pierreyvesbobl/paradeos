import { vi } from "vitest";
import type { Database } from "@/db/client";
import type { AuthUser } from "@/lib/auth/server";

/**
 * Setup commun des tests d'intégration. Les Server Actions passent par deux
 * portes qu'on remplace ici : `db()` (pool postgres-js sur DATABASE_URL) et
 * `getUser()` (session Supabase en cookie). Tout le reste — validation Zod,
 * rôles, requêtes, règles métier — tourne en vrai contre PGlite.
 */

let currentDb: Database | null = null;
let currentUser: AuthUser | null = null;

/** Branche la base PGlite du fichier de test sur `@/lib/db/server`. */
export function useTestDb(db: Database | null) {
  currentDb = db;
}

/** Utilisateur « connecté » vu par `getUser()` / `requireUser()`. `null` = anonyme. */
export function actAs(user: { id: string; email?: string } | null) {
  currentUser = user ? { id: user.id, email: user.email, user_metadata: {} } : null;
}

vi.mock("@/lib/db/server", () => ({
  db: async () => {
    if (!currentDb) throw new Error("useTestDb() n'a pas été appelé dans ce fichier de test.");
    return currentDb;
  },
}));

vi.mock("@/lib/auth/server", () => ({
  getUser: async () => currentUser,
  requireUser: async () => {
    if (!currentUser) throw new Error("redirect:/login");
    return currentUser;
  },
}));

// `revalidatePath` exige un contexte de requête Next ; hors de lui il lève.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));
