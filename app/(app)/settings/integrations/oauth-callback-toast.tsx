"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

const MESSAGES: Record<string, { kind: "success" | "error" | "info"; text: string }> = {
  connected: { kind: "success", text: "Google Drive connecté." },
  disconnected: { kind: "info", text: "Google Drive déconnecté." },
  error_state: { kind: "error", text: "Échec OAuth : state invalide (réessaie depuis ce poste)." },
  error_missing_params: { kind: "error", text: "Échec OAuth : paramètres manquants." },
  error_missing_refresh: {
    kind: "error",
    text: "Google n'a pas renvoyé de refresh_token. Révoque l'accès dans ton compte Google puis réessaie.",
  },
  error_no_email: { kind: "error", text: "Échec OAuth : email Google non communiqué." },
  error_exchange: { kind: "error", text: "Échec OAuth : échange du code refusé." },
  error_access_denied: { kind: "info", text: "Connexion Google annulée." },
};

/**
 * Affiche un toast au retour du flow OAuth (callback redirige avec
 * `?google=<status>`) puis nettoie l'URL pour éviter le re-fire au
 * refresh.
 */
export function OauthCallbackToast({ status }: { status: string }) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const msg =
      MESSAGES[status] ??
      (status.startsWith("error_")
        ? { kind: "error" as const, text: `Échec OAuth (${status}).` }
        : { kind: "info" as const, text: status });

    if (msg.kind === "success") toast.success(msg.text);
    else if (msg.kind === "error") toast.error(msg.text);
    else toast.info(msg.text);

    router.replace("/settings/integrations");
  }, [status, router]);

  return null;
}
