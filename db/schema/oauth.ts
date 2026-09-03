import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Clients OAuth 2.1 enregistrés dynamiquement (RFC 7591). Les clients MCP
 * (Claude.ai, Claude Desktop, Cursor…) s'enregistrent seuls au premier
 * contact : on ne connaît pas leur `client_id` à l'avance.
 *
 * La plupart sont des clients *publics* (pas de secret, PKCE obligatoire) ;
 * `clientSecretHash` n'est rempli que si le client demande explicitement
 * une auth `client_secret_post` / `client_secret_basic`.
 */
export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    clientId: text("client_id").notNull().unique(),
    clientSecretHash: text("client_secret_hash"),
    clientName: text("client_name").notNull(),
    /** Liste exacte des redirect URIs autorisés — comparaison stricte. */
    redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
    grantTypes: jsonb("grant_types").$type<string[]>().notNull(),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull(),
    scope: text("scope").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    createdIdx: index("oauth_clients_created_idx").on(t.createdAt),
  }),
);

/**
 * Codes d'autorisation — usage unique, courte durée (60 s). On ne stocke
 * que le SHA-256 du code : une fuite de la base ne permet pas de rejouer
 * un code encore valide.
 */
export const oauthAuthorizationCodes = pgTable(
  "oauth_authorization_codes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    codeHash: text("code_hash").notNull().unique(),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    /** PKCE — S256 uniquement, `plain` est refusé à l'authorize. */
    codeChallenge: text("code_challenge").notNull(),
    scope: text("scope").notNull(),
    /** RFC 8707 : ressource pour laquelle le futur token sera valable. */
    resource: text("resource").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    expiresIdx: index("oauth_codes_expires_idx").on(t.expiresAt),
  }),
);

/**
 * Access tokens et refresh tokens, stockés hashés comme les PAT.
 * `resource` porte l'audience : le resource server refuse un token dont
 * la ressource ne correspond pas à sa propre URI canonique (RFC 8707).
 *
 * Les refresh tokens sont *rotatifs* : `replacedBy` chaîne les générations,
 * ce qui permet de détecter un rejeu (un refresh déjà remplacé qui revient
 * = token volé → on révoque toute la chaîne).
 */
export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tokenHash: text("token_hash").notNull().unique(),
    /** `access` | `refresh`. */
    kind: text("kind").notNull(),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    resource: text("resource").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedBy: uuid("replaced_by"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    userIdx: index("oauth_tokens_user_idx").on(t.userId),
    expiresIdx: index("oauth_tokens_expires_idx").on(t.expiresAt),
  }),
);

export type OauthClient = typeof oauthClients.$inferSelect;
export type OauthToken = typeof oauthTokens.$inferSelect;
