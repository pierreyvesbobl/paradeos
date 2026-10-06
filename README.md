# Parade OS

Outil interne de Parade SAS (Lyon). Modélisation unifiée :
`projects.kind = client | product | transverse` — pas de table `brands`.

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript strict · Supabase (Auth, Postgres,
Storage) · Drizzle ORM · Tailwind 4 + shadcn/ui · Zod ·
Server Actions · pnpm · Biome · Vercel.

Région Supabase : `eu-central-1` (Frankfurt).

## Setup local en 5 commandes

```bash
# 1. Dépendances
pnpm install

# 2. Variables d'env
cp .env.example .env.local
# → renseigner NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#   DATABASE_URL (Project Settings > Database > Session pooler).

# 3. Migrations Drizzle (crée users / tags / taggings / audit_log)
pnpm db:generate && pnpm db:migrate

# 4. Migrations SQL Supabase (RLS + triggers audit, requiert supabase CLI lié)
supabase db push

# 5. Seed des 3 users + lancement
pnpm seed && pnpm dev
```

> Sans la CLI Supabase, on peut coller le contenu de
> `supabase/migrations/*.sql` directement dans le SQL editor du dashboard.

## Structure

```
app/                      Next.js App Router
  (auth)/login/           magic link
  (app)/                  zone authentifiée (sidebar+topbar)
    page.tsx              dashboard
    error.tsx             error boundary de la zone (garde le layout)
    not-found.tsx         404 (notFound() des pages détail)
    projets/ contacts/ entites/ taches/ temps/ notes/ meetings/
    inbox/ emails/ compta/ coworking/ settings/
  api/
    cron/                 jobs Vercel Cron (Bearer CRON_SECRET)
    mcp/ oauth/           serveur MCP HTTP + OAuth (RFC 8414/9728)
    google/ dougs/ linkedin/ meetings/ note-attachments/
  global-error.tsx        dernier filet (erreur du root layout)
components/
  ui/                     primitives shadcn
  layout/                 sidebar, topbar, command palette, user menu
  emails/ coworking/ tasks/ notes/ projets/   composants par domaine
db/
  client.ts               pool postgres-js partagé (globalThis en dev)
  schema/*.ts             un fichier par domaine (pas de barrel)
  migrations/             générées par drizzle-kit
lib/
  actions/                Server Actions (helper action() + actions par domaine)
  auth/server.ts          getUser / requireUser
  db/server.ts            client Drizzle (rôle postgres, sécurité côté app)
  db/queries/             requêtes de lecture partagées
  schemas/                Zod par domaine
  supabase/               clients server / browser / proxy / admin (service_role)
  gmail/ google/ dougs/ linkedin/ meetings/   intégrations
  format.ts               formats fr-FR (€, dates)
proxy.ts                  auth gate global (ex-middleware.ts, convention Next 16)
mcp-server/               serveur MCP stdio (dev local) ; tools/ par domaine, tools.ts les agrège
chrome-extension/         extension navigateur (synchro cookie Dougs, import LinkedIn)
scripts/                  seed, magic-link, diagnostics
scripts/archive/          scripts one-shot déjà joués (ne pas relancer)
supabase/migrations/      RLS + triggers SQL
docs/design/              handoffs Claude Design (.dc.html)
```

### Sécurité des Server Actions

`lib/db/server.ts` se connecte avec le rôle `postgres`, qui **bypass
RLS**. Toute la sécurité repose donc sur le code applicatif :

- Toute action passe par `action()` (`lib/actions/action.ts`) qui
  valide le payload Zod et exige un user authentifié.
- Un fichier `"use server"` expose **chaque export** comme endpoint
  appelable. Les helpers qui prennent un `userId` explicite (sync
  calendrier, crons) ne doivent jamais y vivre : les mettre dans
  `lib/<domaine>/` (ex. `lib/google/calendar-sync.ts`).

## Tests

- `pnpm test` : unitaires (Vitest), fonctions pures de `lib/`, ~1 s.
- `pnpm test:integration` : Server Actions et crons contre une base Postgres
  embarquée (PGlite, `tests/integration/`). Le schéma Drizzle y est poussé
  tel quel, sans Docker ni Supabase local ; `db()`, `getUser()` et
  `next/cache` sont remplacés dans `tests/integration/setup.ts`, tout le
  reste tourne en vrai. Les appels sortants (Dougs, mail) se simulent par
  `vi.mock` dans le fichier de test. Non couvert, volontairement : RLS,
  triggers SQL et schéma `auth`.
- `pnpm test:e2e` : Playwright, smoke non connecté.

### Rôle applicatif `paradeos_app` (migration 0081)

Un rôle sans DDL, sans accès aux schémas `auth`/`storage`, avec des policies
permissives explicites sur `public` (Supabase ne laisse pas créer de rôle
BYPASSRLS). Il est créé `NOLOGIN` : pour basculer la prod dessus,

1. lui donner un mot de passe : `alter role paradeos_app login password '…';`
2. sur Vercel, `DATABASE_URL` → la même URL de pooler avec l'utilisateur
   `paradeos_app.<ref projet>` ;
3. garder l'URL `postgres` en local pour les migrations (drizzle-kit et les
   scripts SQL font du DDL).

## Conventions

- Fichiers `kebab-case`, composants React `PascalCase`.
- Server Components par défaut ; `"use client"` uniquement si nécessaire.
- Pas de `any`, pas de `@ts-ignore`. Si tu ne sais pas typer, dis-le.
- Une feature = un dossier dans `app/(app)/[module]/` avec composants colocated.
- Pas de barrel files (`index.ts` qui réexporte). Imports directs.
- Schémas Zod dans `lib/schemas/` par domaine.
- Server Actions dans `lib/actions/` par domaine, jamais inline dans les pages.
- Commits français, format conventionnel : `feat:`, `fix:`, `chore:`.
- Décimales en français (virgules), montants en euros HT par défaut.

## Ajouter une migration

1. Modifier ou créer un schéma dans `db/schema/<domaine>.ts`.
2. `pnpm db:generate` — drizzle-kit produit le SQL dans `db/migrations/`.
3. Relire le SQL généré avant de l'appliquer.
4. `pnpm db:migrate` (local ou cloud selon `DATABASE_URL`).
5. Si la migration touche RLS ou triggers : ajouter un fichier
   `supabase/migrations/<numéro>_<sujet>.sql` puis l'appliquer avec
   `pnpm exec tsx scripts/apply-supabase-sql-one.ts <fichier>` (la base n'a
   pas d'historique `supabase_migrations`, `supabase db push` ne s'applique
   pas). Toute migration qui crée une table se termine par
   `select public.grant_paradeos_app();` (cf. 0081).

## Sécurité

- Les `.env.local` ne sont **jamais** commités (cf. `.gitignore`).
- Le `service_role` Supabase n'est utilisé que côté serveur (seed,
  jobs admin, helper `dbAdmin()`). Il bypass RLS — à manier avec soin.
- L'audit log est alimenté par triggers Postgres (`audit_log_trigger`),
  donc rien n'y échappe, même un INSERT direct.

## Email transactionnel (Resend)

Les e-mails transactionnels (notifications de mention, digest quotidien)
passent par [Resend](https://resend.com). En dev, mettre
`EMAIL_DELIVERY=console` dans `.env.local` pour logger les e-mails dans
stdout au lieu de les envoyer.

### Config Resend

1. Créer un compte sur https://resend.com.
2. Vérifier un domaine (ex. `parade.fr`) dans **Domains**.
3. Générer une API key dans **API Keys**.
4. Mettre dans `.env.local` :
   ```
   RESEND_API_KEY=re_xxx
   EMAIL_FROM="Parade OS <noreply@parade.fr>"
   EMAIL_DELIVERY=resend
   ```

### Magic links sans rate limit

Le SMTP Supabase par défaut limite à ~3 e-mails/heure — gênant en dev
pour tester les magic links. **Solution** : configurer Resend comme
SMTP relay pour Supabase Auth :

1. Dashboard Supabase → **Settings → Authentication → SMTP Settings**.
2. Activer "Enable Custom SMTP".
3. Renseigner :
   - **Host** : `smtp.resend.com`
   - **Port** : `465`
   - **Username** : `resend`
   - **Password** : la même API key Resend (`RESEND_API_KEY`)
   - **Sender email** : adresse sur ton domaine vérifié
   - **Sender name** : `Parade OS`
4. Save → les magic links sortent désormais via Resend, plus de rate
   limit Supabase.

### Cron quotidien (Vercel)

`vercel.json` configure un cron à `7h UTC` (8h Paris CET / 9h CEST) sur
`/api/cron/daily-digest`. Vercel signe la requête avec
`Authorization: Bearer $CRON_SECRET`. Définir `CRON_SECRET` dans
Vercel → Settings → Environment Variables.

Pour tester en local :
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/daily-digest
```

## Phase 0 — état

- ✅ Auth magic link (Supabase Auth)
- ✅ Layout app (sidebar + topbar + Cmd+K placeholder)
- ✅ Tables transverses : `users`, `tags`, `taggings`, `audit_log`
- ✅ RLS + trigger `handle_new_user` + trigger générique d'audit
- ✅ Helper `action(schema, handler)` + helper `db()` authentifié
- ✅ Page `/settings/profile`
- ✅ Seed 3 users
- ⏳ Modules métier : Contacts, Opportunités, Projets, Tâches, Planning
