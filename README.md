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
claude-mod/               mod Claude Code : suivi du temps → time_entries (source claude_code)
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

### Suivi du temps Claude Code (`claude-mod/`)

Un mod Claude Code (plugin de function hooks, `claude --plugin-dir claude-mod`)
compte le temps d'attention passé dans une session et l'écrit dans
`time_entries` avec `source = claude_code`, imputé au projet dont un dépôt
(`project_repos`, remote normalisé par `lib/git/remote.ts`) correspond au
remote git de la session. Un dépôt inconnu déclenche une question dans
Claude Code ; la réponse est partagée entre machines. Côté serveur, trois
tools MCP : `resolve_repo`, `link_repo`, `track_claude_time` (upsert par
`source_ref`). Le rapport /temps ventile par provenance et partage à parts
égales les minutes de deux sessions ouvertes en parallèle
(`lib/time/overlap.ts`). Règles de comptage et installation :
`claude-mod/README.md`.

Les dépôts GitHub rattachés donnent aussi une fenêtre sur leurs issues
ouvertes depuis la fiche projet (`components/projets/project-issues-section.tsx`,
client `lib/github/issues.ts`) : lecture en direct avec le réglage
`GITHUB_TOKEN` (PAT à granularité fine, « Issues : lecture »), cache de deux
minutes, rien n'est stocké. Les pull requests, que l'API mêle aux issues,
sont écartées.

### Clôture des tâches d'après les mails et les réunions

Les extractions LLM (`lib/gmail/extract.ts`, `lib/meetings/extract.ts`)
reçoivent les tâches ouvertes avec une référence courte (`[T12]`, celles du
projet concerné en tête) et renvoient dans `completedTasks` celles que le
contenu donne pour faites, avec une citation et une confiance
`certain | probable`. La persistance en fait des propositions de kind
`task_completion` (`matched_id` = la tâche) dans `meeting_proposals` /
`email_proposals`, visibles dans /inbox, sur la réunion et sur le fil mail.
Accepter passe la tâche en `done` et mémorise son état d'avant dans le
payload ; annuler la rouvre dans ce statut (`lib/tasks/complete.ts`,
`lib/tasks/completion-proposals.ts`).

Réglage `TASK_AUTOCOMPLETE_ENABLED` (opt-in, `/settings/integrations`) :
une détection `certain` sur une tâche jamais soumise à l'humain est
appliquée sans clic, la ligne naît `accepted` sans décideur et reste
annulable depuis l'historique /inbox. Règle anti-boucle : la ré-extraction
n'applique plus jamais d'office une tâche déjà proposée une fois. Les enums
`*_proposal_kind` ne se réduisent pas (`ADD VALUE` sans retour) : migration
`0090`.

### Rattachement automatique des réunions à un projet

`lib/meetings/project-signals.ts` (règles pures) et
`lib/meetings/project-attach.ts` (indices en base). Chaque indice pèse :
projet reconnu à coup sûr dans le transcript 0,8, nom du projet dans le
titre 0,8, nom d'un client à projet unique dans le titre 0,6 (0,5 réparti
sinon), trois quarts des tâches proposées sur le projet 0,5, participants
contacts du projet 0,4 réparti. On rattache dès 0,8, si aucun autre
projet ne dépasse 0,3 : une réunion transverse reste sans projet. Projets
perdus, terminés et archivés exclus. Appelé en fin d'extraction et par le
cron des transcripts Drive (40 réunions sans projet par passage, une
réévaluation par jour). Trace sur `meetings.project_auto_at` /
`project_auto_reason` (migration `0099`) : une réunion détachée à la main
après un rattachement automatique n'est plus jamais rattachée d'office.

### Ré-extraire une source déjà triée

Relancer l'extraction d'une réunion ou d'un mail n'efface que ses
propositions encore `pending` ou `expired`. Celles déjà tranchées restent, et la nouvelle
passe ne repose rien d'équivalent (`DecidedProposals` dans
`lib/crm/proposal-keys.ts`, clé par nature : titre + projet pour une tâche,
cible pour une liaison, une seule par source pour un brouillon de réponse) :
un refus ne revient pas dans l'inbox, une acceptation n'est pas reproposée.
La tâche née d'une acceptation reçoit tout de même les passages de la
nouvelle passe, en `origin`. On peut donc relancer les réunions anciennes
pour poser « ce qui a été dit » sans rien retrier.

### Garder la file /inbox digeste

Une ligne par proposition et un humain qui refuse 80 % de ce qu'on lui
montre : la file servait de filtre, pas de validation. Quatre règles, côté
mails (`lib/gmail/`) :

- **Expéditeurs machines** (`automated-sender.ts`) : reçus, alertes, notes
  automatiques, services SaaS. Pas d'appel LLM, le message passe en
  `extraction_status = skipped`. Le classement des factures lit ses pièces
  jointes comme avant.
- **Péremption** (`lib/crm/expire-proposals.ts`) : une proposition `pending`
  depuis plus de 7 jours, mail ou réunion, passe en `expired` à la relève
  Gmail suivante ; une proposition née d'un mail de robot expire sans
  attendre, de même qu'un « Répondre à X » ou un brouillon de réponse dont
  le fil a reçu un message envoyé (`SENT`) après le mail d'origine
  (`lib/gmail/reply-tasks.ts`). L'extraction d'un mail déjà répondu ne
  propose pas « Répondre » et ne le marque pas « réponse attendue ».
  Plus généralement, les propositions de tâche en attente du fil et du
  projet, nées de mails comme de réunions (`lib/crm/pending-proposals.ts`),
  entrent dans le vocabulaire du LLM de chaque extraction, mail ou réunion
  (`PROPOSAL_REF_PREFIX`, bloc « Tâches proposées… ») : un message qui
  les donne pour faites ou sans objet les clôt (`expired`, pas un refus).
  La relève extrait les messages dans l'ordre d'arrivée pour que la
  réponse soit lue après la demande. Rattrapage de l'existant à chaque relève
  (`requeueThreadsWithPendingProposals`) : 3 fils par passage dont un
  message plus récent n'a pas revu les propositions en attente sont
  rejoués en mode passages seuls (`requeuedForPendingProposals`, marqueur
  `pendingProposalsSeen`). Ce mode ne pose ni n'efface aucune proposition
  du message rejoué. Les rattachements d'avant la règle des 5 candidats
  expirent (`expireUndecidableProjectLinks`). Ce n'est pas un refus : absente de l'historique et des
  pages source, elle est reposée si on ré-extrait (migrations `0096`,
  `0097`).
- **Regroupement** : /inbox affiche une ligne par source seule et un groupe
  replié par message ou réunion dès deux propositions, avec « Tout
  accepter » / « Tout refuser » sans confirmation (`groupKey` sur
  `InboxItem`).
- **Rattachement projet sans clic** : quand le projet nommé dans le mail
  (match certain) est aussi l'un de ceux que désignent les participants, la
  liaison est posée comme pour un candidat unique. Sans projet nommé et
  avec plus de 5 candidats, rien n'est proposé : le fil se rattache depuis
  sa page.

### Archivage automatique de la boîte de réception

`lib/gmail/auto-archive.ts`, à chaque relève, derrière deux réglages de
`/settings/integrations` : retirer de l'inbox, jamais supprimer.

- `GMAIL_ARCHIVE_DONE_TASKS` (actif par défaut) : un fil dont toutes les
  tâches liées (`task_sources`, propositions acceptées) sont closes, dont
  une au moins terminée, lu, tous messages extraits, sans proposition en
  attente. Un message arrivé après la clôture ne retient pas le fil, c'est
  la règle « action attendue » qui tranche. Pour que le lien existe, le
  vocabulaire de l'extraction liste les tâches terminées depuis 60 jours
  du projet du fil (`mentionedTasks` peut les citer), et la relève rejoue
  3 fils par passage parmi ceux tagués à un projet sans aucun lien de
  tâche (`requeueThreadsForDoneTasks`, extraction en mode « passages
  seulement », marqueur `requeuedForDoneTasks` / `doneTasksSeen` sur
  `extraction_meta`).
- `GMAIL_ARCHIVE_AUTOMATED_DAYS` (`off` par défaut, 3/7/14) : un fil où
  seuls des expéditeurs machines ont écrit, lu ou non, dont le dernier
  message a plus de N jours. 60 fils par relève, avant les phases LLM. Les mails d'agenda
  (invitations, rappels, confirmations de rendez-vous,
  `lib/gmail/calendar-mail.ts`) restent en boîte.

Dans les deux cas, un fil où un message attend une action reste en boîte :
`extraction_meta.needsReply` posé par l'extraction, ou un objet qui
l'annonce (`lib/gmail/action-required.ts` : paiement refusé, pièce à
signer, compte à confirmer, expiration, suspension…). Les frontières de
mots passent par `lib/gmail/word-match.ts` (`\b` ignore les accents).

Avant de choisir, la relève remet le miroir local d'accord avec Gmail sur
ce qui est en boîte (`reconcileInboxMirror`, `threads.list` sur `INBOX`) :
un fil rangé à la main il y a des mois n'est plus compté ni retenté. Un
fil disparu de Gmail (404) est sorti de la boîte locale sans trace.

La trace est sur `gmail_threads.auto_archived_at` / `auto_archive_reason`
(migration `0098`) : un fil remis en boîte à la main n'est pas repris tant
qu'aucun message plus récent n'arrive.

Les brouillons de réponse ne sont plus générés ni affichés (`needsReply`
reste porté par le message ; le kind `draft_reply` survit dans l'enum pour
les lignes historiques).

### Ce qui a été dit d'une tâche (`task_sources`)

Une tâche extraite ne garde pas que son titre : les mêmes extractions
renvoient, pour chaque tâche nouvelle (`proposedTasks[].excerpts`) et pour
chaque tâche ouverte réévoquée sans être close (`mentionedTasks`), les
passages verbatim du transcript ou du mail qui en parlent, avec qui parle.
Ils s'accumulent dans `task_sources` (migration `0091`), une ligne par
passage, pointant la réunion ou le message : `origin` (posée à l'acceptation
de la proposition, ou directement sur la tâche existante si la proposition
est écartée comme doublon), `mention` (posée dès l'extraction, sans
validation : c'est du contexte, pas une décision), `completion` (la citation
d'une clôture). La ré-extraction d'une source efface ses `mention` /
`completion` et les repose ; l'empreinte normalisée du passage
(`lib/tasks/task-sources.ts`, pur ; écriture dans
`lib/tasks/record-sources.ts`) rend tout ça idempotent. La fiche tâche les
montre groupés par source et dans l'ordre chronologique (« Ce qui a été
dit ») : c'est la matière d'un brief, humain ou agent.

### Du besoin à l'issue GitHub (`tasks.kind`, `task_github_issues`)

Les extractions qualifient chaque tâche proposée (`kind` : `feature` à
développer, `investigation` à analyser, `action` geste humain ;
`lib/tasks/task-kind.ts`), corrigeable dans le rail de la fiche tâche.
Un dépôt GitHub rattaché au projet (`project_repos.sync_issues`, case
« Issues » sur la fiche projet) reçoit en issue les tâches `feature` : à
l'acceptation d'une proposition, quand une tâche passe en Fonctionnalité,
ou à la demande depuis la fiche. L'issue porte le brief
(`lib/github/issue-brief.ts`) : projet, priorité, lien retour, « Ce qui a
été dit » source par source, et un marqueur caché avec l'id de tâche.
Projection à sens unique (`lib/github/project-issue.ts`) : Parade OS
possède titre et brief et repousse quand ils changent (empreinte dans
`task_github_issues`), GitHub ne possède que la fermeture. Jeton
`GITHUB_TOKEN` en « Issues : lecture et écriture » ; migration `0092`.

La vue « où en est le développement » est le tableau d'issues : onglet
Développement de la fiche projet (par projet), et `/taches/issues` pour tous
les dépôts suivis (bouton Issues de la liste des tâches) :
les issues des dépôts suivis, lues en GraphQL (`lib/github/board.ts`) et
rangées en quatre colonnes déduites de GitHub (`lib/github/issue-board.ts`) :
à développer, en cours (assignée ou PR brouillon liée), en revue (PR liée
prête), livrées (fermées depuis 30 jours). Pas de glisser-déposer : on agit
sur GitHub, le tableau suit. Les PR liées demandent « Pull requests :
lecture » sur le jeton ; sans elle, le tableau ne voit que les assignations.

### La feuille de route du dépôt comme état réel (`repo_roadmaps`, `task_roadmap_links`)

Les issues ne disent pas où en est le développement quand on travaille sur
`main` avec Claude Code. Ce qui le dit, c'est le `roadmap.json` que l'agent
tient dans le dépôt (épics, items numérotés, statuts `done` / `test` /
`doing` / `todo` / `wait` / `idea`, format dans `lib/roadmap/roadmap.ts`).
Parade OS le lit, ne l'écrit jamais : chemin par dépôt
(`project_repos.roadmap_path`, champ « Feuille de route » sur la fiche
projet, jeton avec « Contents : lecture »), instantané dans `repo_roadmaps`,
affichage dans l'onglet Développement. Le rapprochement tâche ↔ item est
proposé par le LLM (`lib/roadmap/match.ts`, une fois par version du fichier
ou quand des tâches arrivent), tranché sous l'item (`task_roadmap_links`,
`suggested` / `confirmed` / `rejected`), ou posé à la main. Un lien
confirmé fait suivre à la tâche le statut de l'item : livré → terminée, en
test ou en attente → en attente client, en cours → en cours
(`lib/roadmap/sync.ts`). Relecture toutes les quinze minutes par le workflow
GitHub, une fois par jour par Vercel, ou « Relire » sur la fiche ; migration
`0093`.

### Ce que Claude Code fait vraiment (`repo_commits`, `task_commit_links`, mod)

La feuille de route ne dit pas tout : ce qui a été fait, c'est ce qui a été
commité. Les commits des dépôts suivis (feuille de route ou projection
d'issues) arrivent par deux chemins dans `repo_commits` : relus sur GitHub
toutes les quinze minutes (`lib/repos/commits-sync.ts`, jeton « Contents :
lecture »), et poussés par le mod Claude Code dès qu'un `git commit` passe
en session (`report_commits`, poussé ou non). Le LLM dit quelle tâche
ouverte chaque commit livre (`lib/repos/match-commits.ts`, chaque commit
examiné une fois) ; la suggestion se tranche sous le commit dans l'onglet
Développement, confirmer termine la tâche. Dans l'autre sens, le mod
demande à Parade OS le contexte du dépôt au démarrage de la session
(`repo_context` : projet, tâches ouvertes, feuille de route) et l'ajoute au
prompt système avec la consigne de signaler l'avancement par
`report_task_progress` (statut + note sur la tâche). Migration `0094`.

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

### Pooler et pool de connexions (incident du 07/10/2026)

En prod, les requêtes **mises en file** derrière le pool postgres-js saturé
(10 connexions, pages à ~15 requêtes parallèles : fiche projet, dashboard)
restaient bloquées côté Postgres en « active, ClientRead » jusqu'au
`statement_timeout`, et la page partait en 500. Jamais reproduit en local sur
le même build. Mesures en place : pool à 20 (`db/client.ts`), prefetch coupé
(`components/link.tsx`), `statement_timeout` du rôle `postgres` à 30 s,
`engines.node` épinglé à `22.x` pendant l'enquête (ce n'était pas la cause :
le blocage persistait sous 22). Le pooler **session** (port 5432) a été essayé
et écarté : il plafonne à 15 clients (`EMAXCONNSESSION`), un pool de 20 par
instance Vercel le dépasse. On reste donc sur le pooler transaction (6543)
avec `max: 20`. Attention : `.env.local` (dev) est en **5432**, la prod en
**6543** — ne jamais copier la valeur locale telle quelle dans Vercel.
`scripts/kill-db-zombies.ts` libère les backends bloqués si ça revient.

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
