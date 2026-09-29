# Crons externes (Vercel Hobby)

Vercel Hobby limite les Cron Jobs à 1× par jour. Pour les jobs qui doivent
tourner plus fréquemment (sync calendar 15 min, sync transcripts Drive et mail
30 min), on les a sortis de `vercel.json` et on les déclenche depuis l'extérieur.

Les endpoints restent en place :

- `GET /api/cron/refresh-calendar-events` — sync events Google Calendar
- `GET /api/cron/ingest-drive-transcripts` — ingestion auto des transcripts Drive
- `GET /api/cron/ingest-email-transcripts` — ingestion des réunions envoyées par
  mail (label Gmail configuré dans les réglages)

Auth : header `Authorization: Bearer $CRON_SECRET`.

## En place aujourd'hui : GitHub Actions

`.github/workflows/crons.yml` appelle les deux endpoints d'ingestion toutes
les 30 minutes. Le dépôt étant public, les minutes Actions sont gratuites.

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
   `/api/cron/ingest-email-transcripts` avec `*/30 * * * *`

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
  "schedule": "*/30 * * * *"
},
{
  "path": "/api/cron/ingest-email-transcripts",
  "schedule": "*/30 * * * *"
}
```

Et c'est plié.
