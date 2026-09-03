/**
 * Endpoint HTTP MCP — JSON-RPC 2.0 over POST. Implémentation pragmatique
 * (pas le full Streamable HTTP transport, mais suffisant pour les
 * tools/list, tools/call, resources/* et prompts/*) que la majorité
 * des clients comprennent.
 *
 * Auth (cf. `lib/oauth/resource-server.ts`) : soit un token personnel
 * `paradeos_pat_…`, soit un access token OAuth `paradeos_oat_…`. Le
 * `userId` du token devient le contexte d'exécution des handlers
 * (équivalent à `PARADEOS_USER_ID` en stdio).
 *
 * Ce fichier joue le rôle de *resource server* OAuth 2.1 : sur 401 il
 * publie un `WWW-Authenticate` pointant vers les métadonnées, ce qui
 * permet à un client de se connecter en ne connaissant que l'URL.
 */
import { getAppUrl } from "@/lib/app-url";
import { CORS_HEADERS, corsPreflight } from "@/lib/oauth/http";
import {
  type McpAuth,
  type McpAuthFailure,
  requireScope,
  resolveMcpAuth,
  wwwAuthenticate,
} from "@/lib/oauth/resource-server";
import { type NextRequest, NextResponse } from "next/server";
import { type ZodTypeAny, z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

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
  createProject,
  createProjectSchema,
  createTask,
  createTaskSchema,
  getEmailThread,
  getEmailThreadSchema,
  getMeeting,
  getMeetingSchema,
  getMeetingTranscript,
  getMeetingTranscriptSchema,
  getNote,
  getNoteSchema,
  getProject,
  getProjectSchema,
  getPromptMessages,
  listContacts,
  listContactsSchema,
  listEmails,
  listEmailsSchema,
  listEntities,
  listEntitiesSchema,
  listMeetings,
  listMeetingsSchema,
  listMyTasks,
  listMyTime,
  listMyTimeSchema,
  listNotes,
  listNotesSchema,
  listProjects,
  listProjectsSchema,
  listTasks,
  listTasksSchema,
  logTime,
  logTimeSchema,
  readResource,
  searchAll,
  searchAllSchema,
  updateContact,
  updateContactSchema,
  updateEntity,
  updateEntitySchema,
  updateProject,
  updateProjectSchema,
} from "./_handlers";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Versions du protocole MCP qu'on sait servir. L'ordre importe : la
 * dernière est celle qu'on propose quand le client en demande une
 * inconnue.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const LATEST_PROTOCOL_VERSION = "2025-06-18";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
};

function rpcResult(id: number | string | null | undefined, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

/** Toute réponse porte les en-têtes CORS : les clients web en ont besoin. */
function rpcJson(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return NextResponse.json(body, { status: init?.status ?? 200, headers });
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
    schema: ZodTypeAny;
    /**
     * Tool qui modifie des données. Exige le scope `mcp:write` — un
     * connecteur autorisé en lecture seule voit ces tools mais reçoit un
     * 403 s'il tente de les appeler.
     */
    write?: boolean;
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
    schema: z.object({}),
    handler: (_a, ctx) => listMyTasks({}, ctx as never),
  },
  list_meetings: {
    description: "Liste les meetings.",
    schema: listMeetingsSchema,
    handler: (a) => listMeetings(a as never),
  },
  get_meeting: {
    description:
      "Détail complet d'un meeting : transcript intégral, résumé markdown, statut de transcription et propositions LLM. Pour ne récupérer que le transcript (sans propositions), préférer `get_meeting_transcript`.",
    schema: getMeetingSchema,
    handler: (a) => getMeeting(a as never),
  },
  get_meeting_transcript: {
    description:
      "Transcript brut d'un meeting (texte intégral) + métadonnées de transcription (status, provider, audio). Réponse compacte sans les propositions LLM.",
    schema: getMeetingTranscriptSchema,
    handler: (a) => getMeetingTranscript(a as never),
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
  update_contact: {
    write: true,
    description: "Met à jour un contact (champs fournis seulement). `id` requis.",
    schema: updateContactSchema,
    handler: (a) => updateContact(a as never),
  },
  list_entities: {
    description: "Liste les entités CRM.",
    schema: listEntitiesSchema,
    handler: (a) => listEntities(a as never),
  },
  update_entity: {
    write: true,
    description: "Met à jour une entité (champs fournis seulement). `id` requis.",
    schema: updateEntitySchema,
    handler: (a) => updateEntity(a as never),
  },
  create_task: {
    write: true,
    description: "Crée une tâche.",
    schema: createTaskSchema,
    handler: (a, ctx) => createTask(a as never, ctx as never),
  },
  create_project: {
    write: true,
    description:
      "Crée un projet / opportunité. ⚠️ GARDE-FOU : `confirmed: true` REQUIS. Demande TOUJOURS confirmation à l'utilisateur avec tous les champs (name, kind, status, entityId, valueAmount…) avant d'invoquer ce tool. Pour les opportunités commerciales : kind='client' + status not_started/to_follow_up/awaiting_response.",
    schema: createProjectSchema,
    handler: (a, ctx) => createProject(a as never, ctx as never),
  },
  update_project: {
    write: true,
    description:
      "Met à jour un projet (champs fournis). `id` requis. Pour les transitions de statut sensibles (won/lost/archived), `confirmed: true` requis — demande confirmation au user.",
    schema: updateProjectSchema,
    handler: (a) => updateProject(a as never),
  },
  complete_task: {
    write: true,
    description: "Marque une tâche comme terminée.",
    schema: completeTaskSchema,
    handler: (a) => completeTask(a as never),
  },
  log_time: {
    write: true,
    description: "Enregistre un créneau de temps.",
    schema: logTimeSchema,
    handler: (a, ctx) => logTime(a as never, ctx as never),
  },
  add_note: {
    write: true,
    description: "Ajoute une note polymorphique.",
    schema: addNoteSchema,
    handler: (a, ctx) => addNote(a as never, ctx as never),
  },
  list_notes: {
    description:
      "Liste les notes polymorphes (memo/call/meeting/message) avec filtres : subjectType+subjectId (notes d'un projet/contact/entité/opportunité/tâche), kind, authorId, mine=true (mes notes), search (titre+contenu), since/until (ISO). Tri occurredAt desc.",
    schema: listNotesSchema,
    handler: (a, ctx) => listNotes(a as never, ctx as never),
  },
  get_note: {
    description: "Détail complet d'une note par id (contenu intégral + auteur + sujet).",
    schema: getNoteSchema,
    handler: (a) => getNote(a as never),
  },
  list_emails: {
    description:
      "Liste les threads Gmail liés à un sujet CRM. subjectType='project' (le plus fréquent) ou 'entity' utilise les tags Gmail dédiés ; 'contact' dérive au runtime via match d'adresse. Args : subjectType, subjectId, since? ISO, limit?. Scopé à la boîte du user courant.",
    schema: listEmailsSchema,
    handler: (a, ctx) => listEmails(a as never, ctx as never),
  },
  get_email_thread: {
    description:
      "Détail d'un thread email par id : messages (from/to/cc, bodyText, date, labels) + tags rattachés. Scopé à la boîte du user.",
    schema: getEmailThreadSchema,
    handler: (a, ctx) => getEmailThread(a as never, ctx as never),
  },
  search_all: {
    description: "Full-text search.",
    schema: searchAllSchema,
    handler: (a) => searchAll(a as never),
  },
  push_project_quote: {
    write: true,
    description:
      "Pousse un devis sur Dougs depuis un projet Paradeos, stocke le lien atomiquement. Args: projectId, subject?, thankYouNote?, lines[] {title, description?, unit?, quantity, unitAmount, vatRate?}. TVA défaut 0.2.",
    schema: pushProjectQuoteSchema,
    handler: (a, ctx) => pushProjectQuote(a as never, ctx as never),
  },
  push_project_milestone_invoice: {
    write: true,
    description:
      "Crée une facture Dougs depuis un jalon de projet (ou crée le jalon à la volée). Args: projectId, milestoneId? (sinon crée), type? acompte|intermediaire|solde, percent? 0-150, amountHt?, label?.",
    schema: pushProjectMilestoneInvoiceSchema,
    handler: (a, ctx) => pushProjectMilestoneInvoice(a as never, ctx as never),
  },
  push_coworking_invoice: {
    write: true,
    description:
      "Pousse une facture coworking existante sur Dougs (brouillon). Args: coworkingInvoiceId.",
    schema: pushCoworkingInvoiceMcpSchema,
    handler: (a, ctx) => pushCoworkingInvoiceMcp(a as never, ctx as never),
  },
};

/**
 * Convertit un schéma Zod en JSON Schema MCP-compatible : top-level
 * `{ type: "object", properties, required }` sans `$ref` ni `$schema`.
 * Les MCP clients (Claude.ai, Cursor, etc.) s'appuient là-dessus pour
 * savoir quels arguments envoyer — un `{ type: "object" }` vide casse
 * l'appel car le client n'inclut alors aucun arg.
 */
function toMcpInputSchema(schema: ZodTypeAny): Record<string, unknown> {
  const raw = zodToJsonSchema(schema, { target: "openApi3", $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  // Drop legacy openApi metadata + force shape minimale attendue par MCP.
  // biome-ignore lint/performance/noDelete: on veut vraiment supprimer la clé, pas juste undefined
  delete raw.$schema;
  // biome-ignore lint/performance/noDelete: idem
  delete raw.definitions;
  if (raw.type !== "object") {
    return { type: "object" };
  }
  return raw;
}

/**
 * Réponse 401/403 normalisée. Le `WWW-Authenticate` est ce qui déclenche
 * la découverte OAuth côté client — sans lui, un client sans token
 * abandonne au lieu de lancer le flow d'autorisation.
 */
async function authErrorResponse(failure: McpAuthFailure) {
  const appUrl = await getAppUrl();
  return rpcJson(rpcError(null, -32001, failure.description), {
    status: failure.status,
    headers: { "WWW-Authenticate": wwwAuthenticate(appUrl, failure) },
  });
}

export async function POST(req: NextRequest) {
  const resolved = await resolveMcpAuth(req.headers.get("authorization"));
  if (!resolved.ok) return authErrorResponse(resolved.failure);
  const auth: McpAuth = resolved.auth;
  const ctx = { userId: auth.userId, source: "token" as const };

  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return rpcJson(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  if (body.jsonrpc !== "2.0" || !body.method) {
    return rpcJson(rpcError(body.id, -32600, "Invalid Request"), { status: 400 });
  }

  // Notification JSON-RPC (Request sans `id`, ex. `notifications/initialized`) :
  // aucune réponse n'est attendue. Le transport Streamable HTTP veut un
  // 202 Accepted sans corps — y répondre par une erreur casse les clients stricts.
  if (body.id === undefined) {
    return new NextResponse(null, { status: 202, headers: CORS_HEADERS });
  }

  try {
    switch (body.method) {
      case "initialize": {
        // On renvoie la version demandée si on la connaît, sinon la plus
        // récente qu'on supporte. Répondre en dur "2024-11-05" à un client
        // 2025-06-18 le fait basculer en mode dégradé sans raison.
        const requested = (body.params as { protocolVersion?: string } | undefined)
          ?.protocolVersion;
        const protocolVersion =
          requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : LATEST_PROTOCOL_VERSION;
        return rpcJson(
          rpcResult(body.id, {
            protocolVersion,
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: "paradeos", version: "0.5.0" },
          }),
        );
      }

      // Keep-alive du protocole : réponse vide, mais son absence fait
      // considérer le serveur comme mort par certains clients.
      case "ping":
        return rpcJson(rpcResult(body.id, {}));

      case "tools/list":
        return rpcJson(
          rpcResult(body.id, {
            tools: Object.entries(TOOL_REGISTRY).map(([name, t]) => ({
              name,
              description: t.description,
              inputSchema: toMcpInputSchema(t.schema),
            })),
          }),
        );

      case "tools/call": {
        const { name, arguments: rawArgs } = (body.params ?? {}) as {
          name?: string;
          arguments?: unknown;
        };
        if (!name || !TOOL_REGISTRY[name]) {
          return rpcJson(rpcError(body.id, -32601, `Tool inconnu : ${name}`));
        }
        const tool = TOOL_REGISTRY[name];
        if (tool.write) {
          const denied = requireScope(auth, "mcp:write");
          if (denied) return authErrorResponse(denied);
        }
        const parsed = tool.schema.parse(rawArgs ?? {});
        const result = await tool.handler(parsed, ctx);
        return rpcJson(
          rpcResult(body.id, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          }),
        );
      }

      case "resources/list":
        return rpcJson(
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
        if (!uri) return rpcJson(rpcError(body.id, -32602, "uri requis"));
        const data = await readResource(uri, ctx);
        return rpcJson(rpcResult(body.id, { contents: [{ uri, ...data }] }));
      }

      case "prompts/list":
        return rpcJson(rpcResult(body.id, { prompts: PROMPTS }));

      case "prompts/get": {
        const { name, arguments: args } = (body.params ?? {}) as {
          name?: string;
          arguments?: Record<string, string>;
        };
        if (!name) return rpcJson(rpcError(body.id, -32602, "name requis"));
        return rpcJson(rpcResult(body.id, getPromptMessages(name, args ?? {})));
      }

      default:
        return rpcJson(rpcError(body.id, -32601, `Méthode inconnue : ${body.method}`));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur interne";
    console.error("[mcp http]", err);
    return rpcJson(rpcError(body.id, -32603, message));
  }
}

/**
 * Préflight CORS — indispensable pour les clients MCP qui appellent
 * depuis un navigateur (claude.ai).
 */
export function OPTIONS() {
  return corsPreflight();
}

/**
 * Le transport Streamable HTTP permet au client d'ouvrir un flux SSE en
 * GET. On ne le propose pas (tout tient en requête/réponse), et la spec
 * demande alors un 405 explicite — mieux vaut ça qu'un 404 que le client
 * interprète comme « mauvaise URL ».
 *
 * Sans token, on répond quand même 401 + `WWW-Authenticate` : plusieurs
 * clients sondent l'URL en GET avant tout et attendent d'y découvrir
 * comment s'authentifier.
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveMcpAuth(req.headers.get("authorization"));
  if (!resolved.ok) return authErrorResponse(resolved.failure);
  return rpcJson(rpcError(null, -32000, "Flux SSE non supporté — utilise POST."), {
    status: 405,
    headers: { Allow: "POST, OPTIONS" },
  });
}

/** Terminaison de session Streamable HTTP : sans état côté serveur, rien à faire. */
export function DELETE() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
