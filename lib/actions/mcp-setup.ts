"use server";

import { getAppUrl } from "@/lib/app-url";
import { requireUser } from "@/lib/auth/server";
import { MCP_PATH } from "@/lib/oauth/config";
import { revokeSession } from "@/lib/oauth/store";
import { revalidatePath } from "next/cache";

export type DiagnosticStep = {
  label: string;
  ok: boolean;
  detail: string;
};

/**
 * Vérifie que l'installation « colle juste l'URL » va fonctionner depuis
 * cette origine. Les trois points contrôlés sont exactement ceux qui
 * cassent un ajout de connecteur :
 *  1. les métadonnées de la ressource sont servies à la racine ;
 *  2. celles du serveur d'autorisation aussi ;
 *  3. l'endpoint MCP répond 401 *avec* le `WWW-Authenticate` qui déclenche
 *     la découverte — un 401 nu laisse le client abandonner.
 */
export async function checkMcpSetup(): Promise<{ appUrl: string; steps: DiagnosticStep[] }> {
  await requireUser();
  const appUrl = await getAppUrl();
  const steps: DiagnosticStep[] = [];

  async function probe(label: string, path: string, check: (res: Response) => Promise<string>) {
    try {
      const res = await fetch(`${appUrl}${path}`, { cache: "no-store" });
      const detail = await check(res);
      steps.push({ label, ok: !detail.startsWith("!"), detail: detail.replace(/^!/, "") });
    } catch (err) {
      steps.push({
        label,
        ok: false,
        detail: err instanceof Error ? err.message : "Requête impossible.",
      });
    }
  }

  await probe(
    "Métadonnées de la ressource",
    "/.well-known/oauth-protected-resource",
    async (res) => {
      if (!res.ok) return `!HTTP ${res.status}`;
      const body = (await res.json()) as { authorization_servers?: string[] };
      const server = body.authorization_servers?.[0];
      return server ? `serveur d'autorisation : ${server}` : "!`authorization_servers` absent";
    },
  );

  await probe(
    "Métadonnées du serveur d'autorisation",
    "/.well-known/oauth-authorization-server",
    async (res) => {
      if (!res.ok) return `!HTTP ${res.status}`;
      const body = (await res.json()) as { registration_endpoint?: string };
      return body.registration_endpoint
        ? "enregistrement dynamique disponible"
        : "!`registration_endpoint` absent";
    },
  );

  try {
    const res = await fetch(`${appUrl}${MCP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      cache: "no-store",
    });
    const challenge = res.headers.get("www-authenticate");
    steps.push({
      label: "Défi d'authentification MCP",
      ok: res.status === 401 && !!challenge?.includes("resource_metadata"),
      detail:
        res.status !== 401
          ? `attendu 401 sans token, reçu ${res.status}`
          : challenge?.includes("resource_metadata")
            ? "401 + WWW-Authenticate correct"
            : "401 mais `resource_metadata` absent de l'en-tête",
    });
  } catch (err) {
    steps.push({
      label: "Défi d'authentification MCP",
      ok: false,
      detail: err instanceof Error ? err.message : "Requête impossible.",
    });
  }

  return { appUrl, steps };
}

/** Déconnecte un connecteur OAuth : révoque tous ses tokens pour ce user. */
export async function revokeMcpGrant(clientId: string): Promise<{ ok: boolean; message?: string }> {
  const user = await requireUser();
  if (!clientId) return { ok: false, message: "Client inconnu." };
  await revokeSession(clientId, user.id);
  revalidatePath("/settings/integrations");
  return { ok: true };
}
