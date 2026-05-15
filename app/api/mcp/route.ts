/**
 * Endpoint HTTP MCP — JSON-RPC 2.0 over POST. Implémentation pragmatique
 * (pas le full Streamable HTTP transport, mais suffisant pour les
 * tools/list, tools/call, resources/* et prompts/*) que la majorité
 * des clients comprennent.
 *
 * Auth : `Authorization: Bearer paradeos_pat_<…>` résolu contre la
 * table `user_api_tokens`. Le `userId` du token devient le contexte
 * d'exécution des handlers (équivalent à `PARADEOS_USER_ID` en stdio).
 */
import { resolveToken } from "@/lib/db/queries/api-tokens";
import { type NextRequest, NextResponse } from "next/server";

import {
  pushCoworkingInvoiceMcp,
  pushCoworkingInvoiceMcpSchema,
  pushProjectMilestoneInvoice,
  pushProjectMilestoneInvoiceSchema,
  pushProjectQuote,
  pushProjectQuoteSchema,
} from "./_dougs-handlers";
import {
  PROMPTS,
  RESOURCE_TEMPLATES,
  addNote,
  addNoteSchema,
  completeTask,
  completeTaskSchema,
  createTask,
  createTaskSchema,
  getMeeting,
  getMeetingSchema,
  getProject,
  getProjectSchema,
  getPromptMessages,
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
  readResource,
  searchAll,
  searchAllSchema,
} from "./_handlers";

export const runtime = "nodejs";
export const maxDuration = 60;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
};

function rpcResult(id: number | string | null | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(
  id: number | string | null | undefined,
  code: number,
  message: string,
  data?: unknown,
) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}

const TOOL_REGISTRY: Record<
  string,
  {
    description: string;
    schema: { parse: (i: unknown) => unknown };
    handler: (args: unknown, ctx: { userId: string; source: "token" }) => Promise<unknown>;
  }
> = {
  list_projects: {
    description: "Liste les projets Paradeos avec filtres.",
    schema: listProjectsSchema,
    handler: (a) => listProjects(a as never),
  },
  get_project: {
    description: "Détail complet d'un projet (par id ou nom).",
    schema: getProjectSchema,
    handler: (a) => getProject(a as never),
  },
  list_tasks: {
    description: "Liste les tâches avec filtres.",
    schema: listTasksSchema,
    handler: (a) => listTasks(a as never),
  },
  list_my_tasks: {
    description: "Mes tâches assignées encore ouvertes.",
    schema: { parse: () => ({}) },
    handler: (_a, ctx) => listMyTasks({}, ctx as never),
  },
  list_meetings: {
    description: "Liste les meetings.",
    schema: listMeetingsSchema,
    handler: (a) => listMeetings(a as never),
  },
  get_meeting: {
    description: "Détail d'un meeting + propositions LLM.",
    schema: getMeetingSchema,
    handler: (a) => getMeeting(a as never),
  },
  list_my_time: {
    description: "Mon temps passé sur une période.",
    schema: listMyTimeSchema,
    handler: (a, ctx) => listMyTime(a as never, ctx as never),
  },
  list_contacts: {
    description: "Liste les contacts CRM.",
    schema: listContactsSchema,
    handler: (a) => listContacts(a as never),
  },
  list_entities: {
    description: "Liste les entités CRM.",
    schema: listEntitiesSchema,
    handler: (a) => listEntities(a as never),
  },
  create_task: {
    description: "Crée une tâche.",
    schema: createTaskSchema,
    handler: (a, ctx) => createTask(a as never, ctx as never),
  },
  complete_task: {
    description: "Marque une tâche comme terminée.",
    schema: completeTaskSchema,
    handler: (a) => completeTask(a as never),
  },
  log_time: {
    description: "Enregistre un créneau de temps.",
    schema: logTimeSchema,
    handler: (a, ctx) => logTime(a as never, ctx as never),
  },
  add_note: {
    description: "Ajoute une note polymorphique.",
    schema: addNoteSchema,
    handler: (a, ctx) => addNote(a as never, ctx as never),
  },
  search_all: {
    description: "Full-text search.",
    schema: searchAllSchema,
    handler: (a) => searchAll(a as never),
  },
  push_project_quote: {
    description:
      "Pousse un devis sur Dougs depuis un projet Paradeos, stocke le lien atomiquement. Args: projectId, subject?, thankYouNote?, lines[] {title, description?, unit?, quantity, unitAmount, vatRate?}. TVA défaut 0.2.",
    schema: pushProjectQuoteSchema,
    handler: (a, ctx) => pushProjectQuote(a as never, ctx as never),
  },
  push_project_milestone_invoice: {
    description:
      "Crée une facture Dougs depuis un jalon de projet (ou crée le jalon à la volée). Args: projectId, milestoneId? (sinon crée), type? acompte|intermediaire|solde, percent? 0-150, amountHt?, label?.",
    schema: pushProjectMilestoneInvoiceSchema,
    handler: (a, ctx) => pushProjectMilestoneInvoice(a as never, ctx as never),
  },
  push_coworking_invoice: {
    description:
      "Pousse une facture coworking existante sur Dougs (brouillon). Args: coworkingInvoiceId.",
    schema: pushCoworkingInvoiceMcpSchema,
    handler: (a, ctx) => pushCoworkingInvoiceMcp(a as never, ctx as never),
  },
};

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const match = auth?.match(/^Bearer\s+(paradeos_pat_[A-Za-z0-9_-]+)$/);
  if (!match) {
    return NextResponse.json(rpcError(null, -32001, "Token manquant ou mal formé."), {
      status: 401,
    });
  }
  const tokenStr = match[1];
  if (!tokenStr) {
    return NextResponse.json(rpcError(null, -32001, "Token mal formé."), { status: 401 });
  }
  const resolved = await resolveToken(tokenStr);
  if (!resolved) {
    return NextResponse.json(rpcError(null, -32001, "Token invalide ou révoqué."), {
      status: 401,
    });
  }
  const ctx = { userId: resolved.userId, source: "token" as const };

  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  if (body.jsonrpc !== "2.0" || !body.method) {
    return NextResponse.json(rpcError(body.id, -32600, "Invalid Request"), { status: 400 });
  }

  try {
    switch (body.method) {
      case "initialize":
        return NextResponse.json(
          rpcResult(body.id, {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: "paradeos", version: "0.4.0" },
          }),
        );

      case "tools/list":
        return NextResponse.json(
          rpcResult(body.id, {
            tools: Object.entries(TOOL_REGISTRY).map(([name, t]) => ({
              name,
              description: t.description,
              inputSchema: { type: "object" },
            })),
          }),
        );

      case "tools/call": {
        const { name, arguments: rawArgs } = (body.params ?? {}) as {
          name?: string;
          arguments?: unknown;
        };
        if (!name || !TOOL_REGISTRY[name]) {
          return NextResponse.json(rpcError(body.id, -32601, `Tool inconnu : ${name}`));
        }
        const tool = TOOL_REGISTRY[name];
        const parsed = tool.schema.parse(rawArgs ?? {});
        const result = await tool.handler(parsed, ctx);
        return NextResponse.json(
          rpcResult(body.id, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          }),
        );
      }

      case "resources/list":
        return NextResponse.json(
          rpcResult(body.id, {
            resources: RESOURCE_TEMPLATES.map((t) => ({
              uri: t.uriTemplate.includes("{")
                ? (t.uriTemplate.split("{")[0] ?? t.uriTemplate)
                : t.uriTemplate,
              name: t.name,
              description: t.description,
              mimeType: t.mimeType,
            })),
          }),
        );

      case "resources/read": {
        const uri = (body.params as { uri?: string } | undefined)?.uri;
        if (!uri) return NextResponse.json(rpcError(body.id, -32602, "uri requis"));
        const data = await readResource(uri, ctx);
        return NextResponse.json(rpcResult(body.id, { contents: [{ uri, ...data }] }));
      }

      case "prompts/list":
        return NextResponse.json(rpcResult(body.id, { prompts: PROMPTS }));

      case "prompts/get": {
        const { name, arguments: args } = (body.params ?? {}) as {
          name?: string;
          arguments?: Record<string, string>;
        };
        if (!name) return NextResponse.json(rpcError(body.id, -32602, "name requis"));
        return NextResponse.json(rpcResult(body.id, getPromptMessages(name, args ?? {})));
      }

      default:
        return NextResponse.json(rpcError(body.id, -32601, `Méthode inconnue : ${body.method}`));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur interne";
    console.error("[mcp http]", err);
    return NextResponse.json(rpcError(body.id, -32603, message));
  }
}
