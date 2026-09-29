import "server-only";

import { googleAccounts } from "@/db/schema/google-accounts";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { eq } from "drizzle-orm";

/**
 * Cherche un user admin avec un compte Google connecté pour exécuter
 * une ingestion sous son identité. Les crons (watch Drive, file d'attente
 * Gmail) n'ont pas de contexte user — on impersonate un admin, seul
 * porteur d'un refresh token Google.
 */
export async function getIngestionUserId(): Promise<string | null> {
  const [first] = await getIngestionUserIds();
  return first ?? null;
}

/**
 * Tous les admins avec un compte Google connecté. L'ingestion par mail
 * en a besoin : le label surveillé vit dans *une* boîte, et rien ne dit
 * laquelle. On les balaie donc toutes plutôt que de parier sur la
 * première ligne rendue par Postgres.
 */
export async function getIngestionUserIds(): Promise<string[]> {
  const conn = await db();
  const rows = await conn
    .select({ id: users.id })
    .from(users)
    .innerJoin(googleAccounts, eq(googleAccounts.userId, users.id))
    .where(eq(users.role, "admin"))
    .orderBy(users.createdAt);
  return rows.map((r) => r.id);
}
