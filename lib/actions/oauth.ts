"use server";

import { getAppUrl } from "@/lib/app-url";
import { requireUser } from "@/lib/auth/server";
import { parseAuthorizeParams } from "@/lib/oauth/authorize-params";
import { isAcceptableResource, resourceUri } from "@/lib/oauth/config";
import { createAuthorizationCode, getClient } from "@/lib/oauth/store";
import { redirect } from "next/navigation";

/**
 * Approbation de l'écran de consentement. Revalide *tout* côté serveur —
 * la page a déjà vérifié les mêmes règles, mais ce formulaire est la
 * frontière de confiance : on ne fait confiance à aucun champ caché.
 *
 * Renvoie une chaîne d'erreur, ou redirige vers le client MCP avec le code.
 */
export async function approveAuthorization(formData: FormData): Promise<string | undefined> {
  const user = await requireUser();

  const raw = formData.get("params");
  if (typeof raw !== "string") return "Requête invalide.";
  const parsed = parseAuthorizeParams(new URLSearchParams(raw));
  if (!parsed.ok) return parsed.description;
  const params = parsed.params;

  const client = await getClient(params.clientId);
  if (!client) return "Client inconnu.";
  // Redirection ouverte : comparaison stricte à la liste enregistrée.
  if (!client.redirectUris.includes(params.redirectUri)) {
    return "`redirect_uri` non enregistré pour ce client.";
  }

  const appUrl = await getAppUrl();
  if (params.resource && !isAcceptableResource(params.resource, appUrl)) {
    return "Ressource demandée inconnue de ce serveur.";
  }

  const code = await createAuthorizationCode({
    clientId: params.clientId,
    userId: user.id,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    scope: params.scope,
    resource: resourceUri(appUrl),
  });

  const target = new URL(params.redirectUri);
  target.searchParams.set("code", code);
  if (params.state) target.searchParams.set("state", params.state);
  redirect(target.toString());
}

/** Refus explicite : on renvoie l'erreur `access_denied` au client. */
export async function denyAuthorization(formData: FormData): Promise<string | undefined> {
  await requireUser();

  const raw = formData.get("params");
  if (typeof raw !== "string") return "Requête invalide.";
  const parsed = parseAuthorizeParams(new URLSearchParams(raw));
  if (!parsed.ok) return parsed.description;
  const params = parsed.params;

  const client = await getClient(params.clientId);
  if (!client || !client.redirectUris.includes(params.redirectUri)) {
    return "Client ou redirect_uri inconnu.";
  }

  const target = new URL(params.redirectUri);
  target.searchParams.set("error", "access_denied");
  target.searchParams.set("error_description", "L'utilisateur a refusé l'accès.");
  if (params.state) target.searchParams.set("state", params.state);
  redirect(target.toString());
}
