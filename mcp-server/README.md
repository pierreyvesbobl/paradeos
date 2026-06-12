# Paradeos MCP server

Serveur MCP (Model Context Protocol) qui expose Paradeos comme un set
d'outils consommables par Claude Desktop / Cursor / tout client MCP.

## Setup

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

### Writes
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

Chaque user de l'équipe (3 actuellement) configure sa propre instance
Claude Desktop avec son `PARADEOS_USER_ID`. Les tools `my_*` filtrent
sur ce user ; les autres tools (projets, contacts, etc.) sont team-wide.

## Mode HTTP (v0.4)

Si tu préfères ne pas installer le CLI localement, Paradeos expose
aussi un endpoint HTTP MCP à `https://<paradeos-domain>/api/mcp`.
Génère un token sur `/settings/integrations` (section "Mes accès MCP")
puis configure ton client MCP avec :

```jsonc
{
  "mcpServers": {
    "paradeos": {
      "url": "https://paradeos.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer paradeos_pat_…" }
    }
  }
}
```

(Note : l'usage HTTP nécessite un client MCP qui supporte le transport
Streamable HTTP, ou un bridge `mcp-remote`. À tester selon ton client.)
