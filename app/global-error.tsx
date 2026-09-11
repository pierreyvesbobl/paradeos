"use client";

import { useEffect } from "react";

/**
 * Dernier filet : capture les erreurs du root layout lui-même. Doit
 * rendre ses propres <html>/<body> car le layout racine n'est plus
 * disponible à ce niveau. Volontairement sans dépendance (pas de Tailwind
 * garanti, pas de composant partagé) pour ne jamais échouer.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          color: "#1f1f1f",
          background: "#fafaf9",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
            Parade OS ne répond plus.
          </h1>
          <p style={{ fontSize: 14, margin: "0 0 16px", color: "#6b6b6b" }}>
            Une erreur bloquante est survenue
            {error.digest ? ` (référence ${error.digest})` : ""}.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "8px 14px",
              fontSize: 14,
              borderRadius: 6,
              border: "1px solid #d4d4d4",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Recharger
          </button>
        </div>
      </body>
    </html>
  );
}
