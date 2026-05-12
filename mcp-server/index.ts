#!/usr/bin/env tsx
/**
 * Paradeos MCP server (stdio transport) — point d'entrée pour Claude
 * Desktop. Lit `DATABASE_URL` + `PARADEOS_USER_ID` depuis l'env.
 *
 * Usage Claude Desktop :
 *   "paradeos": {
 *     "command": "/path/to/paradeos/node_modules/.bin/tsx",
 *     "args": ["/path/to/paradeos/mcp-server/index.ts"],
 *     "env": {
 *       "DATABASE_URL": "postgres://…",
 *       "PARADEOS_USER_ID": "<auth.uid>"
 *     }
 *   }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { getStdioContext } from "./context";
import { closeDb } from "./db";
import { PROMPTS, getPromptMessages } from "./prompts";
import { RESOURCE_TEMPLATES, readResource } from "./resources";
import {
  addNote,
  addNoteSchema,
  completeTask,
  completeTaskSchema,
  createContact,
  createContactSchema,
  createEntity,
  createEntitySchema,
  createTask,
  createTaskSchema,
  getMeeting,
  getMeetingSchema,
  getProject,
  getProjectSchema,
  listContacts,
  listContactsSchema,
  listEntities,
  listEntitiesSchema,
  listMeetings,
  listMeetingsSchema,
  listMyTasks,
  listMyTime,
  listMyTimeSchema,
  listProjects,
  listProjectsSchema,
  listTasks,
  listTasksSchema,
  logTime,
  logTimeSchema,
  searchAll,
  searchAllSchema,
  updateContact,
  updateContactSchema,
  updateEntity,
  updateEntitySchema,
} from "./tools";

// Si lancé en standalone (pas via Next), charge .env.local pour récupérer
// DATABASE_URL et autres. On skippe quand Claude Desktop a déjà injecté
// l'env (sinon les "tips" stdout de dotenv cassent le canal JSON-RPC).
if (!process.env.DATABASE_URL) {
  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ path: ".env", quiet: true });
}

const ctx = getStdioContext();

const server = new McpServer(
  { name: "paradeos", version: "0.4.0" },
  {
    // `tools` est auto-déclaré quand on appelle `server.tool(...)`.
    // `resources` / `prompts` doivent être posés à la main puisqu'on
    // utilise les handlers bas-niveau (server.server.setRequestHandler).
    capabilities: { tools: {}, resources: {}, prompts: {} },
  },
);

// ---------- READ TOOLS ----------

server.tool(
  "list_projects",
  "Liste les projets Paradeos avec filtres (status, kind, recherche fuzzy par nom).",
  listProjectsSchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await listProjects(args), null, 2) }],
  }),
);

server.tool(
  "get_project",
  "Détail complet d'un projet (entité, owner, tâches, temps passé). Lookup par id UUID ou nom.",
  getProjectSchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await getProject(args), null, 2) }],
  }),
);

server.tool(
  "list_tasks",
  "Liste les tâches avec filtres (project, assignee, status, openOnly).",
  listTasksSchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await listTasks(args), null, 2) }],
  }),
);

server.tool(
  "list_my_tasks",
  "Mes tâches assignées encore ouvertes (todo/in_progress/blocked), triées par échéance puis priorité.",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(await listMyTasks({}, ctx), null, 2) }],
  }),
);

server.tool(
  "list_meetings",
  "Liste les meetings avec filtres (project, since).",
  listMeetingsSchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await listMeetings(args), null, 2) }],
  }),
);

server.tool(
  "get_meeting",
  "Détail d'un meeting (transcript, résumé, propositions LLM).",
  getMeetingSchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await getMeeting(args), null, 2) }],
  }),
);

server.tool(
  "list_my_time",
  "Mon temps passé (planned + actual) sur une période, avec total en minutes.",
  listMyTimeSchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await listMyTime(args, ctx), null, 2) }],
  }),
);

server.tool(
  "list_contacts",
  "Liste les contacts CRM avec filtres (entity, recherche).",
  listContactsSchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await listContacts(args), null, 2) }],
  }),
);

server.tool(
  "list_entities",
  "Liste les entités CRM (clients, prospects, partners, suppliers).",
  listEntitiesSchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await listEntities(args), null, 2) }],
  }),
);

// ---------- WRITE TOOLS ----------

server.tool(
  "create_task",
  "Crée une tâche. Par défaut assignée au current user, status=todo, priority=medium.",
  createTaskSchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await createTask(args, ctx), null, 2) }],
  }),
);

server.tool(
  "complete_task",
  "Marque une tâche comme terminée (status=done, completedAt=now).",
  completeTaskSchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await completeTask(args), null, 2) }],
  }),
);

server.tool(
  "log_time",
  "Enregistre un créneau de temps (planned ou actual). Par défaut kind=actual, userId=current user.",
  logTimeSchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await logTime(args, ctx), null, 2) }],
  }),
);

server.tool(
  "add_note",
  "Ajoute une note polymorphique sur un projet/contact/entité/tâche/opportunité.",
  addNoteSchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await addNote(args, ctx), null, 2) }],
  }),
);

server.tool(
  "create_contact",
  "Crée un contact CRM. Ownership = current user.",
  createContactSchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await createContact(args, ctx), null, 2) }],
  }),
);

server.tool(
  "update_contact",
  "Met à jour un contact (champs fournis seulement). `id` requis.",
  updateContactSchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await updateContact(args), null, 2) }],
  }),
);

server.tool(
  "create_entity",
  "Crée une entité CRM (société). Ownership = current user.",
  createEntitySchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await createEntity(args, ctx), null, 2) }],
  }),
);

server.tool(
  "update_entity",
  "Met à jour une entité (champs fournis seulement). `id` requis.",
  updateEntitySchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await updateEntity(args), null, 2) }],
  }),
);

// ---------- SEARCH ----------

server.tool(
  "search_all",
  "Full-text search sur projets, tâches, contacts, entités, meetings.",
  searchAllSchema.shape,
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await searchAll(args), null, 2) }],
  }),
);

// ---------- RESOURCES ----------

server.server.setRequestHandler(z.object({ method: z.literal("resources/list") }), async () => ({
  resources: RESOURCE_TEMPLATES.map((t) => ({
    uri: t.uriTemplate.includes("{")
      ? (t.uriTemplate.split("{")[0] ?? t.uriTemplate)
      : t.uriTemplate,
    name: t.name,
    description: t.description,
    mimeType: t.mimeType,
  })),
}));

server.server.setRequestHandler(
  z.object({
    method: z.literal("resources/read"),
    params: z.object({ uri: z.string() }),
  }),
  async (req) => ({
    contents: [
      {
        uri: req.params.uri,
        ...(await readResource(req.params.uri, ctx)),
      },
    ],
  }),
);

// ---------- PROMPTS ----------

server.server.setRequestHandler(z.object({ method: z.literal("prompts/list") }), async () => ({
  prompts: PROMPTS,
}));

server.server.setRequestHandler(
  z.object({
    method: z.literal("prompts/get"),
    params: z.object({
      name: z.string(),
      arguments: z.record(z.string()).optional(),
    }),
  }),
  async (req) => getPromptMessages(req.params.name, req.params.arguments ?? {}),
);

// ---------- BOOT ----------

const transport = new StdioServerTransport();
await server.connect(transport);

// Cleanup propre au shutdown.
process.on("SIGINT", async () => {
  await closeDb();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await closeDb();
  process.exit(0);
});
