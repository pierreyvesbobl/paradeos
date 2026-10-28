"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { refreshGmailIfStale } from "@/lib/actions/gmail";

/**
 * Relance une courte sync Gmail à l'ouverture de la page quand le dernier
 * passage date de plus d'un quart d'heure, puis rafraîchit la liste s'il y
 * a du nouveau. Invisible sinon : pas de spinner, pas de message.
 */
export function GmailAutoRefresh() {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    let cancelled = false;
    refreshGmailIfStale({})
      .then((res) => {
        if (cancelled || !res.ok || !res.data.ran || res.data.inserted === 0) return;
        const n = res.data.inserted;
        toast.success(
          `${n} nouveau${n > 1 ? "x" : ""} mail${n > 1 ? "s" : ""} relevé${n > 1 ? "s" : ""}.`,
        );
        router.refresh();
      })
      .catch(() => {
        // Filet best-effort : un échec ici ne doit rien casser à la page.
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
