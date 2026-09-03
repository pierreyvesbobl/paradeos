import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { oauthAuthorizationCodes, oauthClients, oauthTokens } from "@/db/schema/oauth";
import { db } from "@/lib/db/server";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  TOKEN_PREFIXES,
} from "./config";

/** Même primitive que les PAT : on ne stocke jamais un secret en clair. */
export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Comparaison à temps constant de deux hex digests de même longueur. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------- clients

export type RegisterClientInput = {
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  tokenEndpointAuthMethod: string;
  scope: string;
};

export async function registerClient(input: RegisterClientInput) {
  const conn = await db();
  const clientId = `paradeos_client_${randomSecret()}`;
  const needsSecret = input.tokenEndpointAuthMethod !== "none";
  const clientSecret = needsSecret ? randomSecret() : null;

  const [row] = await conn
    .insert(oauthClients)
    .values({
      clientId,
      clientSecretHash: clientSecret ? hashSecret(clientSecret) : null,
      clientName: input.clientName,
      redirectUris: input.redirectUris,
      grantTypes: input.grantTypes,
      tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
      scope: input.scope,
    })
    .returning({ id: oauthClients.id, createdAt: oauthClients.createdAt });

  return { clientId, clientSecret, createdAt: row?.createdAt ?? new Date() };
}

export async function getClient(clientId: string) {
  const conn = await db();
  const [row] = await conn
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  return row ?? null;
}

/**
 * Garde-fou anti-abus sur l'enregistrement dynamique, qui est par nature
 * un endpoint public non authentifié : au-delà de 60 créations par heure
 * (tous clients confondus), on refuse. Un usage normal en crée une poignée.
 */
export async function recentClientRegistrations(): Promise<number> {
  const conn = await db();
  const [row] = await conn
    .select({ count: sql<number>`count(*)::int` })
    .from(oauthClients)
    .where(gt(oauthClients.createdAt, new Date(Date.now() - 60 * 60 * 1000)));
  return row?.count ?? 0;
}

/** Vérifie le secret d'un client confidentiel. Public client → toujours ok. */
export function clientSecretMatches(
  client: { clientSecretHash: string | null },
  provided: string | null,
): boolean {
  if (!client.clientSecretHash) return true;
  if (!provided) return false;
  return safeEqual(client.clientSecretHash, hashSecret(provided));
}

// ------------------------------------------------------------------ codes

export type CreateCodeInput = {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
};

/**
 * Purge opportuniste, accrochée à l'autorisation — un chemin rare (quelques
 * fois par mois) plutôt qu'un cron dédié : les codes vivent 60 s et les
 * tokens 1 h / 30 j, la table ne grossit pas assez pour mériter son propre
 * job. On garde une marge d'un jour pour ne rien supprimer qu'on pourrait
 * vouloir inspecter en cas d'incident.
 */
async function purgeExpired(conn: Awaited<ReturnType<typeof db>>) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    await conn.delete(oauthAuthorizationCodes).where(lt(oauthAuthorizationCodes.expiresAt, cutoff));
    await conn.delete(oauthTokens).where(lt(oauthTokens.expiresAt, cutoff));
  } catch {
    // La purge est un confort : son échec ne doit jamais casser une autorisation.
  }
}

export async function createAuthorizationCode(input: CreateCodeInput): Promise<string> {
  const conn = await db();
  await purgeExpired(conn);
  const code = randomSecret();
  await conn.insert(oauthAuthorizationCodes).values({
    codeHash: hashSecret(code),
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scope: input.scope,
    resource: input.resource,
    expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000),
  });
  return code;
}

/**
 * Consomme un code : marque `consumed_at` de façon atomique (le `where`
 * inclut `consumed_at is null`, donc deux échanges concurrents du même
 * code ne peuvent pas réussir tous les deux) et renvoie sa charge utile.
 */
export async function consumeAuthorizationCode(code: string) {
  const conn = await db();
  const [row] = await conn
    .update(oauthAuthorizationCodes)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(oauthAuthorizationCodes.codeHash, hashSecret(code)),
        isNull(oauthAuthorizationCodes.consumedAt),
      ),
    )
    .returning();
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

// ----------------------------------------------------------------- tokens

export type IssueTokensInput = {
  clientId: string;
  userId: string;
  scope: string;
  resource: string;
};

export async function issueTokens(input: IssueTokensInput) {
  const conn = await db();
  const accessToken = `${TOKEN_PREFIXES.access}${randomSecret()}`;
  const refreshToken = `${TOKEN_PREFIXES.refresh}${randomSecret()}`;
  const now = Date.now();

  const rows = await conn
    .insert(oauthTokens)
    .values([
      {
        tokenHash: hashSecret(accessToken),
        kind: "access",
        clientId: input.clientId,
        userId: input.userId,
        scope: input.scope,
        resource: input.resource,
        expiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000),
      },
      {
        tokenHash: hashSecret(refreshToken),
        kind: "refresh",
        clientId: input.clientId,
        userId: input.userId,
        scope: input.scope,
        resource: input.resource,
        expiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    ])
    .returning({ id: oauthTokens.id, kind: oauthTokens.kind });

  // `returning()` respecte l'ordre d'insertion, mais on retrouve la ligne
  // par son `kind` plutôt que par son index — un accès positionnel ici
  // renverrait silencieusement l'id de l'access token.
  const refreshId = rows.find((r) => r.kind === "refresh")?.id ?? null;

  return {
    accessToken,
    refreshToken,
    refreshId,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

export async function findToken(kind: "access" | "refresh", token: string) {
  const conn = await db();
  const [row] = await conn
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.tokenHash, hashSecret(token)), eq(oauthTokens.kind, kind)))
    .limit(1);
  return row ?? null;
}

/**
 * Rotation du refresh token (OAuth 2.1 §4.3.1, obligatoire pour les
 * clients publics). Si un refresh **déjà remplacé** est présenté, c'est
 * le signe d'un rejeu : on révoque toute la session du client pour ce
 * user plutôt que d'émettre un nouveau couple.
 */
export async function rotateRefreshToken(row: {
  id: string;
  clientId: string;
  userId: string;
  scope: string;
  resource: string;
  replacedBy: string | null;
  revokedAt: Date | null;
  expiresAt: Date;
}) {
  const conn = await db();

  if (row.replacedBy || row.revokedAt || row.expiresAt.getTime() < Date.now()) {
    await revokeSession(row.clientId, row.userId);
    return null;
  }

  const issued = await issueTokens({
    clientId: row.clientId,
    userId: row.userId,
    scope: row.scope,
    resource: row.resource,
  });

  await conn
    .update(oauthTokens)
    .set({ revokedAt: new Date(), replacedBy: issued.refreshId })
    .where(eq(oauthTokens.id, row.id));

  return issued;
}

/** Révoque tous les tokens vivants d'un couple (client, user). */
export async function revokeSession(clientId: string, userId: string) {
  const conn = await db();
  await conn
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(oauthTokens.clientId, clientId),
        eq(oauthTokens.userId, userId),
        isNull(oauthTokens.revokedAt),
      ),
    );
}

export async function revokeToken(token: string) {
  const conn = await db();
  await conn
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthTokens.tokenHash, hashSecret(token)), isNull(oauthTokens.revokedAt)));
}

/**
 * Résolution d'un access token pour le resource server. Renvoie null si
 * le token est inconnu, révoqué ou expiré ; l'appelant vérifie ensuite
 * l'audience (`resource`) et les scopes.
 */
export async function resolveAccessToken(token: string) {
  const row = await findToken("access", token);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  const conn = await db();
  // Best-effort, comme pour les PAT — ne bloque pas la requête.
  conn
    .update(oauthTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(oauthTokens.id, row.id))
    .catch(() => undefined);

  return { userId: row.userId, scope: row.scope, resource: row.resource, clientId: row.clientId };
}

/**
 * Sessions OAuth actives d'un user, pour l'écran Réglages — une ligne par
 * client. L'agrégation n'est pas cosmétique : la rotation des refresh
 * tokens et une ré-autorisation du même client laissent plusieurs lignes
 * vivantes, qui s'afficheraient en doublon.
 */
export async function listUserGrants(userId: string) {
  const conn = await db();
  return conn
    .select({
      clientId: oauthTokens.clientId,
      clientName: sql<string | null>`max(${oauthClients.clientName})`,
      scope: sql<string>`max(${oauthTokens.scope})`,
      lastUsedAt: sql<Date | string | null>`max(${oauthTokens.lastUsedAt})`,
      createdAt: sql<Date | string>`min(${oauthTokens.createdAt})`,
    })
    .from(oauthTokens)
    .leftJoin(oauthClients, eq(oauthClients.clientId, oauthTokens.clientId))
    .where(
      and(
        eq(oauthTokens.userId, userId),
        eq(oauthTokens.kind, "refresh"),
        isNull(oauthTokens.revokedAt),
      ),
    )
    .groupBy(oauthTokens.clientId);
}
