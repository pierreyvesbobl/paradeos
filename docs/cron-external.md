# Crons externes (Vercel Hobby)

Vercel Hobby limite les Cron Jobs à 1× par jour. Pour les jobs qui doivent
tourner plus fréquemment (sync calendar 15 min, sync transcripts Drive et mail
15 min), on les a sortis de `vercel.json` et on les déclenche depuis l'extérieur.

Les endpoints restent en place :

- `GET /api/cron/refresh-calendar-events` — sync events Google Calendar
- `GET /api/cron/ingest-drive-transcripts` — ingestion auto des transcripts Drive
- `GET /api/cron/ingest-email-transcripts` — ingestion des réunions envoyées par
  mail (label Gmail configuré dans les réglages)
- `GET /api/cron/sync-gmail` — sync incrémentale Gmail : nouveaux messages,
  auto-liaison des fils aux projets/contacts et projection en libellés Gmail,
  extraction LLM, classement des factures, réponses aux candidatures. Reste
  aussi dans `vercel.json` (6 h 30) en filet de sécurité ; un verrou en base
  (`gmail_sync_state.sync_started_at`) empêche deux runs simultanés.
- `GET /api/cron/file-sales-invoices` — classe dans le Drive comptable les
  factures de vente émises dont le PDF n'y est pas encore. Sert au rattrapage
  du stock historique, puis de filet : une facture finalisée à la main dans
  Dougs ne passe par aucun envoi de notre côté et ne serait jamais classée.
  Idempotent, par lots de 25.

Auth : header `Authorization: Bearer $CRON_SECRET`.

## En place aujourd'hui : GitHub Actions

`.github/workflows/crons.yml` appelle les deux endpoints d'ingestion et la
sync Gmail tous les quarts d'heure. Le dépôt étant public, les minutes Actions
sont gratuites.

Cadence réelle, mesurée en octobre 2026 : GitHub ne respecte pas le `*/15` sur
ce dépôt et ne lance que 6 à 7 runs par jour, espacés de 2 à 7 heures. C'est
déjà bien mieux que le passage quotidien de Vercel Hobby, mais pour un vrai
quart d'heure il faut passer par cron-job.org (option 2 ci-dessous) ou par
Vercel Pro.

Filet côté app : l'ouverture de `/emails` relance une sync Gmail courte
(60 s de budget) quand le dernier passage date de plus d'un quart d'heure
(`lib/actions/gmail.ts:refreshGmailIfStale`). Les mails sont donc là quand
on regarde, même si GitHub n'est pas passé ; les libellés Gmail et les
extractions LLM qui n'ont pas tenu dans le budget attendent le run suivant.

Pourquoi 15 et pas 30 : la dérive GitHub s'ajoute à l'intervalle, donc à
`*/30` un transcript déposé par Meet pouvait attendre 40 minutes. Un run à
vide ne coûte que deux requêtes HTTP.

Prérequis : le secret `CRON_SECRET` du dépôt doit valoir la variable
d'environnement `CRON_SECRET` de Vercel (Production) —

```sh
gh secret set CRON_SECRET   # colle la valeur, elle n'est jamais affichée
```

Sans ce secret, le workflow échoue dès la première étape avec un message
explicite plutôt qu'une salve de 401.

Deux caveats assumés : la planification GitHub peut dériver de 5 à 10
minutes, et un workflow planifié est désactivé après 60 jours sans activité
sur le dépôt. Pour un job d'ingestion, les deux sont sans conséquence.

Le `refresh-calendar-events` (15 min) n'y est pas : à ajouter dans le même
fichier avec un second `schedule` si le besoin se confirme.

## Les autres options



### 1. Boutons UI (manuel)

Pour Drive transcripts : `/settings/integrations` → section « Transcripts Drive »
→ bouton **Sync now**. Idem pour les mails : section « Transcripts par mail » →
bouton **Sync now**. Pour Calendar : section « Google Calendar » → bouton
**Resync events**. Suffit pour un usage ponctuel.

### 2. cron-job.org (gratuit, recommandé)

1. Crée un compte sur https://cron-job.org
2. Nouveau cron :
   - URL : `https://<ton-domaine>/api/cron/refresh-calendar-events`
   - Schedule : `*/15 * * * *`
   - Header : `Authorization: Bearer <CRON_SECRET>`
3. Idem pour `/api/cron/ingest-drive-transcripts` et
   `/api/cron/ingest-email-transcripts` avec `*/15 * * * *`

Free tier suffit largement (jusqu'à 50 crons, exécution illimitée).

### 3. GitHub Actions cron (gratuit)

Ajoute un workflow `.github/workflows/cron.yml` :

```yaml
name: External crons
on:
  schedule:
    - cron: "*/15 * * * *"  # GitHub Actions a une granularité min de ~5 min
jobs:
  refresh-calendar:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsSL -X GET \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            https://<ton-domaine>/api/cron/refresh-calendar-events
```

Caveat : GitHub Actions cron peut avoir 5-10 min de latence et n'est pas
garanti d'être pile à l'heure. OK pour des jobs non-critiques.

## Si tu passes Vercel Pro

Re-mets les entrées dans `vercel.json` :

```json
{
  "path": "/api/cron/refresh-calendar-events",
  "schedule": "*/15 * * * *"
},
{
  "path": "/api/cron/ingest-drive-transcripts",
  "schedule": "*/15 * * * *"
},
{
  "path": "/api/cron/ingest-email-transcripts",
  "schedule": "*/15 * * * *"
}
```

Et c'est plié.
