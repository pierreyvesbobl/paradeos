"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Props = {
  name: string;
  defaultValue: string;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  /** Délai avant déclenchement de la recherche après la dernière frappe (ms). */
  debounceMs?: number;
};

/**
 * Input texte avec recherche live (URL mise à jour 300ms après la
 * dernière frappe) + bouton × pour vider rapidement. Modifie uniquement
 * le param `name` du query string, les autres params (filtres, tri,
 * pagination) sont préservés tels quels.
 *
 * Enter resoumet le form parent → utile quand l'user veut forcer
 * immédiatement (avant l'expiration du debounce).
 */
export function SearchInputWithClear({
  name,
  defaultValue,
  placeholder,
  className,
  ariaLabel,
  debounceMs = 300,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resync si la prop change (navigation back/forward).
  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  // Push l'URL avec la nouvelle valeur. Préserve tous les autres params
  // existants. `router.refresh()` est nécessaire en Next 15 pour que
  // les Server Components se re-fetchent quand seul un query param change.
  //
  // ⚠ On garde toujours le param dans l'URL (même vide) pour signaler
  // au server-side `applyViewPrefRedirect` que c'est un choix explicite
  // de l'user — sinon il re-rappliquerait les filtres sauvegardés.
  function pushUrl(next: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set(name, next.trim());
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    router.refresh();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => pushUrl(next), debounceMs);
  }

  function clear() {
    if (timer.current) clearTimeout(timer.current);
    setValue("");
    // Belt-and-suspenders : force le DOM à se mettre à jour, sans
    // attendre le commit React (utile si le focus est resté sur l'input).
    if (inputRef.current) inputRef.current.value = "";
    pushUrl("");
  }

  // Cleanup timer au démontage pour éviter un push après unmount.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className={cn("relative", className)}>
      <Input
        ref={inputRef}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-9 pr-8"
      />
      {value ? (
        <button
          type="button"
          onClick={clear}
          aria-label="Vider la recherche"
          className="-translate-y-1/2 absolute top-1/2 right-2 inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
