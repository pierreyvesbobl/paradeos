/**
 * Définition des tools MCP : lectures, écritures, recherche.
 *
 * Chaque tool reçoit `(args, ctx)` où `ctx` porte le `userId` du
 * caller (résolu via env stdio ou token HTTP). Les tools "perso"
 * (préfixés `my_*`) filtrent par ctx.userId ; les tools "team"
 * exposent les données partagées.
 */

export * from "./tools/coworking";
export * from "./tools/crm";
export * from "./tools/emails";
export * from "./tools/meetings";
export * from "./tools/notes";
export * from "./tools/projects";
export * from "./tools/tasks-time";
