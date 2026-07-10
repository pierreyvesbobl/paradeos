"use client";

import { patchTask } from "@/lib/actions/tasks";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Titre inline en `contentEditable`. Commit sur blur (pas par frappe)
 * pour ne pas spammer patchTask. Retombe sur « Sans titre » si le
 * champ est vidé, comme le prévoit le handoff.
 */
export function TaskTitleEditor({ id, value }: { id: string; value: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [display, setDisplay] = useState(value);
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setDisplay(value);
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.textContent = value;
    }
  }, [value]);

  function commit() {
    const next = (ref.current?.textContent ?? "").trim() || "Sans titre";
    if (next === display) return;
    const prev = display;
    setDisplay(next);
    if (ref.current) ref.current.textContent = next;
    startTransition(async () => {
      const res = await patchTask({ id, title: next });
      if (!res.ok) {
        setDisplay(prev);
        if (ref.current) ref.current.textContent = prev;
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <h1
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      className="-mx-2 -my-1 cursor-text rounded-md px-2 py-1 font-brand font-semibold text-[32px] text-foreground leading-[1.16] outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {display}
    </h1>
  );
}
