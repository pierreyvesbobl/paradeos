# Paradeos MCP server

Serveur MCP (Model Context Protocol) qui expose Paradeos comme un set
d'outils consommables par Claude.ai / Claude Desktop / Claude Code /
Cursor / tout client MCP.

Trois modes de connexion, par ordre de préférence :

| Transport | Pour qui | Ce qu'il faut fournir |
| --- | --- | --- |
| **HTTP + OAuth** | tout le monde | l'URL, rien d'autre |
| HTTP + token | clients sans OAuth | l'URL + un token personnel |
| stdio | dev sur le repo cloné | `DATABASE_URL` + `PARADEOS_USER_ID` |

## Setup — HTTP + OAuth (recommandé)

Colle `https://<paradeos-domain>/api/mcp` dans ton client. Il découvre
seul comment s'authentifier, ouvre une page Paradeos, tu cliques
« Autoriser », c'est fini. Aucun secret ne transite par un fichier de
config.

- **Claude.ai / Claude Desktop** — Réglages → Connecteurs → « Ajouter un
  connecteur personnalisé », colle l'URL, laisse les réglages avancés vides.
- **Claude Code** — `claude mcp add --transport http paradeos https://<domain>/api/mcp`
  puis `/mcp` pour lancer l'autorisation.
- **Cursor** — bouton « Installer dans Cursor » sur `/settings/integrations`.

Le bouton « Vérifier la configuration » de cette page teste que la
découverte est bien servie depuis l'adresse courante.

### Comment ça marche

Paradeos joue les deux rôles de la spec MCP : *authorization server* et
*resource server*, sur la même origine.

```
client                     Paradeos
  │  POST /api/mcp (sans token)
  │─────────────────────────────────▶
  │  401 + WWW-Authenticate: resource_metadata="…"
  │◀─────────────────────────────────
  │  GET /.well-known/oauth-protected-resource   (RFC 9728)
  │  GET /.well-known/oauth-authorization-server (RFC 8414)
  │  POST /api/oauth/register                    (RFC 7591, DCR)
  │  navigateur → /oauth/authorize  → écran de consentement
  │  POST /api/oauth/token  (code + PKCE S256 + resource)
  │◀── access token (1 h) + refresh token (30 j, rotatif)
  │  POST /api/mcp  Authorization: Bearer paradeos_oat_…
```

Garanties côté serveur :

- **PKCE S256 obligatoire** — `plain` est refusé, les codes vivent 60 s
  et sont à usage unique (consommation atomique).
- **Audience validée** (RFC 8707) — un token émis pour une autre
  ressource est rejeté.
- **Refresh rotatifs** — rejouer un refresh déjà échangé révoque toute
  la session, c'est la signature d'un vol de token.
- **Redirect URIs en liste blanche**, comparaison exacte ; HTTPS exigé
  sauf loopback.
- **Scopes** — `mcp:read` et `mcp:write`. Un connecteur en lecture seule
  reçoit un 403 sur les tools d'écriture.
- Codes et tokens **stockés hashés** (SHA-256), jamais en clair.

L'autorisation exige une session Supabase : seuls les membres de
l'équipe peuvent approuver un client.

### Révoquer

Réglages → Intégrations → « Connecteurs autorisés » → icône corbeille.
Le client devra redemander l'accès.

## Setup — HTTP + token personnel

Pour un client qui ne sait pas faire OAuth. Génère un token sur
`/settings/integrations`, puis :

```jsonc
{
  "mcpServers": {
    "paradeos": {
      "url": "https://<paradeos-domain>/api/mcp",
      "headers": { "Authorization": "Bearer paradeos_pat_…" }
    }
  }
}
```

Ou en une commande : `claude mcp add --transport http paradeos
https://<domain>/api/mcp --header "Authorization: Bearer paradeos_pat_…"`.

Ces tokens portent tous les scopes et n'expirent pas — d'où la
préférence pour OAuth.

## Setup — stdio (dev local)

### 1. Récupère ton `auth.uid` Supabase

C'est l'UUID de ton user dans `auth.users` (Supabase). Tu peux le voir
dans le dashboard Supabase ou via une requête SQL :

```sql
select id from public.users where full_name = 'Ton Nom';
```

### 2. Configure Claude Desktop

Édite `~/Library/Application Support/Claude/claude_desktop_config.json` :

```jsonc
{
  "mcpServers": {
    "paradeos": {
      "command": "/ABSOLUTE/PATH/TO/paradeos/node_modules/.bin/tsx",
      "args": ["/ABSOLUTE/PATH/TO/paradeos/mcp-server/index.ts"],
      "env": {
        "DATABASE_URL": "postgres://postgres.<ref>:<password>@<host>:6543/postgres",
        "PARADEOS_USER_ID": "<ton-auth-uid>"
      }
    }
  }
}
```

`DATABASE_URL` = même chaîne que dans `paradeos/.env.local` (Session
pooler Supabase).

### 3. Redémarre Claude Desktop

Tu devrais voir l'outil `paradeos` apparaître dans le panel des MCP
servers. Tu peux maintenant demander à Claude :

- "Liste mes tâches en retard"
- "Crée une tâche 'Préparer le devis' sur le projet Acme"
- "Combien d'heures j'ai passé sur Refonte du Site cette semaine ?"
- "Synthèse du projet Prev&care" (utilise le prompt `project_summary`)

## Tools exposés

### Reads
- `list_projects` (status, kind, recherche)
- `get_project` (par id ou nom)
- `list_tasks` (project, assignee, status, openOnly)
- `list_my_tasks` — mes tâches ouvertes
- `list_meetings` (project, since)
- `get_meeting` — détail + propositions LLM
- `list_my_time` (period, project) — total en minutes
- `list_contacts` / `list_entities`
- `list_notes` — filtres subjectType+subjectId, kind, authorId, mine, search, since/until
- `get_note` — contenu intégral par id

### Writes (scope `mcp:write`)
- `create_task` — assignée à toi par défaut
- `complete_task` — bascule en `done`
- `log_time` — créneau planned ou actual
- `add_note` — polymorphique (project/contact/etc.)

### Search
- `search_all` — full-text sur projets, tâches, contacts, entités, meetings, **notes**

## Resources (URIs)

- `paradeos://projects` — liste compacte
- `paradeos://projects/{id}` — JSON d'un projet
- `paradeos://meetings/{id}` — markdown du résumé
- `paradeos://tasks/today` — mes tâches du jour
- `paradeos://tasks/overdue` — mes tâches en retard

## Prompts

Slash commands disponibles dans Claude Desktop :

- `/plan_my_week` — planifie ta semaine depuis tâches + meetings + relances
- `/project_summary <project>` — synthèse markdown d'un projet
- `/commercial_brief` — liste des projets à relancer

## Multi-user

Chaque membre autorise son propre connecteur : le `userId` du token
devient le contexte d'exécution. Les tools `my_*` filtrent sur ce user ;
les autres (projets, contacts, etc.) sont team-wide.
