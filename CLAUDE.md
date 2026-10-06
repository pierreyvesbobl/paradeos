# Parade OS — repères pour un agent

- Lis `README.md` d'abord : stack, structure, conventions, sécurité des Server
  Actions, tests, migrations. `AGENTS.md` (écrit par Next) pointe vers la doc
  de la version de Next installée — elle prime sur ce que tu crois savoir.
- Vérifications avant de livrer : `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm test:integration`, `pnpm build`. Le CI rejoue tout, plus Playwright.
- UI : Phosphor Icons et tints du design system, jamais d'emoji ni de
  pictogramme Unicode. Textes en français, montants en € HT par défaut.
- Données : la prod est derrière `DATABASE_URL`. Lecture libre ; écriture ou
  DDL = migration dans `supabase/migrations/` appliquée avec
  `scripts/apply-supabase-sql-one.ts`, et `select public.grant_paradeos_app();`
  après toute nouvelle table.
- Dougs : en local le push répond 401 (Cloudflare bloque Node), ça marche sur
  Vercel — ne pas déboguer ça.
- Commits en français, format conventionnel, un sujet par commit.
