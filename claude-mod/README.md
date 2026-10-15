# paradeos-temps — mod Claude Code

Compte le temps d'attention passé dans Claude Code et le pousse dans
Parade OS comme **signal d'activité** (`claude_code_activity`), rattaché au
projet du dépôt git de la session.

C'est un indicateur, pas un créneau réalisé : rien n'entre dans le temps
compté, la marge ou le TJM. Il dit où est parti l'effort d'une journée, et
l'humain l'arbitre dans `/temps` avec les autres sources (réunions, mails,
calendrier) avant de saisir un vrai `time_entry`. Le mod ne demande donc
jamais rien en pleine session.

Côté Parade OS, les segments contigus d'une même séance (silence < 30 min,
même projet ou même dépôt) forment un **bloc** affiché en fantôme hachuré
dans la grille semaine de `/temps`. Un clic ouvre le dialogue de créneau
prérempli ; enregistrer impute le bloc (`claude_code_activity.time_entry_id`),
qui sort de la grille. Supprimer le créneau l'y ramène. L'onglet Rapport
montre par projet le signal reçu, la part déjà imputée et le reste.

La même consolidation se fait depuis Claude, en fin de journée : le prompt
MCP `consolidate_my_day` (ou à la main `list_claude_activity`, puis
`log_time` avec `claudeSegmentIds`) liste les blocs du jour, les confronte
aux réunions et aux créneaux déjà saisis, et enregistre ce qu'on valide.

## Installation

```bash
claude --plugin-dir /chemin/vers/paradeos/claude-mod
```

ou, pour toutes les sessions, dans `~/.claude/settings.json` :

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/chemin/vers/paradeos/claude-mod" } }
```

Au premier envoi, le mod connecte le serveur MCP `paradeos` déclaré dans
`.mcp.json` : `/mcp` dans Claude Code pour autoriser (OAuth, une fois par
machine). Chaque utilisateur écrit ses propres segments : l'identité vient
du token.

## Règles de comptage (tracker.ts)

1. Un segment court du premier prompt à la dernière réponse, tant que les
   silences restent sous 30 min (`pauseMinutes`). Au-delà, c'est une pause.
2. Un tour qui dépasse 5 min (`capMinutes`) est plafonné : Claude travaille
   seul, l'humain fait autre chose. Si l'humain revient dans les 30 min
   après la fin réelle du tour, le segment suivant démarre à cette fin.
3. Deux sessions en parallèle écrivent deux segments qui se recouvrent ;
   chaque minute commune est partagée à parts égales, donc une heure
   d'horloge reste une heure même répartie sur deux projets.
4. Sous-agents, `claude -p`, crons : pas comptés (personne devant l'écran).

## Cadence des envois

L'écriture est un upsert par `sourceRef` (`<sessionId>:<segment>`) : le
dernier envoi d'un segment porte sa durée finale, donc espacer les envois
ne change pas le résultat, seulement le nombre d'appels réseau.

- un segment fermé part tout de suite ;
- le segment en cours n'est renvoyé que s'il a grandi de 5 min ;
- `session.end` force l'envoi de tout ce qui reste.

Tout segment en attente va dans une file locale partagée par toutes les
sessions de la machine, rejouée au démarrage de la suivante — qu'il ait
été envoyé et raté (hors ligne, serveur non autorisé) ou pas encore dû
(session tuée avant ses cinq premières minutes). Sans cette file, un tel
segment est perdu définitivement : une session fermée ne repasse jamais
sur le sien.

## Résolution du projet

Le mod envoie le remote `origin` normalisé (`github.com/owner/repo`) ;
Parade OS en déduit le projet via `project_repos`, à chaque envoi. Sans
dépôt git (dossier de maquettes, motion design…), il envoie le nom du
dossier de travail et Parade OS le traite comme un dépôt sous la clé
`local/<dossier>` : même rattachement par nom, même picker. Dépôt
inconnu : si un seul projet ouvert porte son nom (même nom, ou l'un
contient l'autre — cf. `lib/repos/link.ts`), il est rattaché sans rien
demander, marqué « auto » sur la fiche projet. Plusieurs candidats, ou
aucun : le signal reste visible dans `/temps` sous son remote, avec un
picker qui propose les candidats en tête. Dans les deux cas, l'activité
déjà poussée sous ce remote est imputée au passage. Un dépôt se rattache
aussi depuis la fiche projet, section « Dépôts git ».

## Ce qui quitte la machine

Horodatages, remote git (ou, sans dépôt, le nom du dossier de travail),
numéro de segment. Jamais le contenu des échanges ni les noms de fichiers.

## Développement

- `pnpm vitest run tests/unit/claude-mod-tracker.test.ts` : règles de comptage.
- `pnpm vitest run tests/integration/claude-time.test.ts` : tools MCP.
- `claude plugin validate claude-mod` : ce que le module hooke et appelle.
- `register.ts` est hors du `tsc` de l'app (module virtuel `claude-code`).
