# paradeos-temps — mod Claude Code

Compte le temps d'attention passé dans Claude Code et le pousse dans
Parade OS comme créneaux réalisés (`time_entries.source = claude_code`),
imputés au projet rattaché au dépôt git de la session.

## Installation

```bash
claude --plugin-dir /chemin/vers/paradeos/claude-mod
```

ou, pour toutes les sessions, dans `~/.claude/settings.json` :

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/chemin/vers/paradeos/claude-mod" } }
```

Au premier tour, le mod connecte le serveur MCP `paradeos` déclaré dans
`.mcp.json` : `/mcp` dans Claude Code pour autoriser (OAuth, une fois par
machine). Chaque utilisateur écrit ses propres créneaux : l'identité vient
du token.

## Règles de comptage (tracker.ts)

1. Un segment court du premier prompt à la dernière réponse, tant que les
   silences restent sous 30 min (`pauseMinutes`). Au-delà, c'est une pause.
2. Un tour qui dépasse 5 min (`capMinutes`) est plafonné : Claude travaille
   seul, l'humain fait autre chose. Si l'humain revient dans les 30 min
   après la fin réelle du tour, le segment suivant démarre à cette fin.
3. Deux sessions en parallèle écrivent deux segments qui se recouvrent ;
   le rapport /temps partage chaque minute commune à parts égales.
4. Sous-agents, `claude -p`, crons : pas comptés (personne devant l'écran).

## Résolution du projet

Le remote `origin` est normalisé (`github.com/owner/repo`) et résolu via
`resolve_repo`. Dépôt inconnu : une question dans Claude Code, avec jusqu'à
trois projets candidats par affinité de nom, ou « Aucun projet ». La
réponse est enregistrée côté Parade OS (`project_repos`) et profite à
toutes les machines. Un dépôt se rattache aussi depuis la fiche projet,
section « Dépôts git ».

## Ce qui quitte la machine

Horodatages, remote git, numéro de segment, titre `Claude Code · <repo>`.
Jamais le contenu des échanges ni les noms de fichiers.

## Développement

- `pnpm vitest run tests/unit/claude-mod-tracker.test.ts` : règles de comptage.
- `claude plugin validate claude-mod` : ce que le module hooke et appelle.
- `register.ts` est hors du `tsc` de l'app (module virtuel `claude-code`).
