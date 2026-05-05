# Parade OS

Outil interne de Parade SAS (Lyon). Modélisation unifiée :
`projects.kind = client | product | transverse` — pas de table `brands`.

## Stack

Next.js 15 (App Router) · TypeScript strict · Supabase (Auth, Postgres,
Storage) · Drizzle ORM · Tailwind + shadcn/ui · TanStack Query · Zod ·
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
    settings/profile/
  auth/callback/          callback PKCE Supabase
components/
  ui/                     primitives shadcn
  layout/                 sidebar, topbar, command palette, user menu
db/
  client.ts               connexion postgres-js partagée
  schema/*.ts             un fichier par domaine (pas de barrel)
  migrations/             générées par drizzle-kit
lib/
  actions/                Server Actions (helper action() + actions par domaine)
  auth/server.ts          getUser / requireUser
  db/server.ts            client Drizzle authentifié (propage JWT pour RLS)
  schemas/                Zod par domaine
  supabase/               clients server / browser / middleware
  format.ts               formats fr-FR (€, dates)
  utils.ts                cn()
middleware.ts             auth gate global
scripts/seed.ts           pnpm seed
supabase/migrations/      RLS + triggers SQL
```

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
   `supabase/migrations/<numéro>_<sujet>.sql` puis `supabase db push`.

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
