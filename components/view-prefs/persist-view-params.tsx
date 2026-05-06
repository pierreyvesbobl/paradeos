"use client";

import { saveViewPref } from "@/lib/actions/view-prefs";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Composant invisible posé sur les pages liste : observe les
 * `searchParams` et persiste (en debounce 500ms) la querystring
 * filtrée aux clés `relevantKeys` pour `pageKey`. La sauvegarde
 * envoie aussi la chaîne vide après un "Réinitialiser", de sorte
 * que la prochaine session démarre vraiment sans filtre.
 */
export function PersistViewParams({
  pageKey,
  relevantKeys,
}: {
  pageKey: string;
  relevantKeys: readonly string[];
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const lastSavedRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialPathRef = useRef(pathname);

  // biome-ignore lint/correctness/useExhaustiveDependencies: searchParams est un proxy stable, on dérive l'usage via toString
  useEffect(() => {
    // Ne persiste que si on est toujours sur la même page (évite
    // d'écraser après navigation interne).
    if (pathname !== initialPathRef.current) return;

    const filtered = new URLSearchParams();
    for (const key of relevantKeys) {
      for (const value of searchParams.getAll(key)) {
        filtered.append(key, value);
      }
    }
    const serialized = filtered.toString();

    if (serialized === lastSavedRef.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastSavedRef.current = serialized;
      void saveViewPref({ pageKey, params: serialized });
    }, 500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [searchParams, pathname, pageKey, relevantKeys.join(",")]);

  return null;
}
