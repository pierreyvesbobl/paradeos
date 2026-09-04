"use client";

import { dismissThreadLink } from "@/lib/actions/gmail";
import { Buildings, Sparkle, User, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

export type ThreadLinkItem = {
  linkId: string;
  labelId: string;
  kind: "entity" | "contact";
  name: string;
  href: string;
  /** Origine : déduite par Paradeos, décidée à la main, ou rangée dans Gmail. */
  source: string;
  manuallyOverridden: boolean;
};

const KIND_META = {
  entity: { Icon: Buildings, noun: "Entité" },
  contact: { Icon: User, noun: "Contact" },
} as const;

function originLabel(source: string, manuallyOverridden: boolean): string {
  if (manuallyOverridden) return "Validé par toi";
  if (source === "manual") return "Rattaché à la main";
  if (source === "gmail") return "Rangé depuis Gmail";
  return "Détecté automatiquement";
}

/**
 * Les autres rattachements du thread (entité, contact). Le projet a sa
 * propre carte, et le sens des factures s'affiche avec les factures
 * détectées : ici on ne montre que ce qui reste, et uniquement pour
 * pouvoir l'invalider.
 *
 * Il n'y a volontairement rien pour « ajouter un tag » : un rattachement
 * naît d'un signal ou d'une proposition validée, jamais d'une saisie.
 */
export function ThreadLinks({ threadId, links }: { threadId: string; links: ThreadLinkItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (links.length === 0) return null;

  function detach(labelId: string, name: string) {
    startTransition(async () => {
      const res = await dismissThreadLink({ threadId, labelId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`${name} détaché de ce fil.`);
      router.refresh();
    });
  }

  return (
    <section
      className="space-y-2 rounded-xl border bg-card p-4"
      style={{ borderColor: "var(--ds-border)" }}
    >
      <h3 className="font-semibold text-[14px]">Autres rattachements</h3>
      <ul className="flex flex-wrap gap-1.5">
        {links.map((l) => {
          const meta = KIND_META[l.kind];
          const Icon = meta.Icon;
          const origin = originLabel(l.source, l.manuallyOverridden);
          return (
            <li
              key={l.linkId}
              className="inline-flex items-center gap-1.5 rounded-md border py-1 pr-1 pl-2"
              style={{ borderColor: "var(--ds-border)" }}
            >
              <Icon size={12} weight="duotone" style={{ color: "var(--ds-text-tertiary)" }} />
              <Link href={l.href} className="text-[12px] hover:underline">
                {l.name}
              </Link>
              <span
                className="inline-flex items-center gap-1 text-[10px]"
                style={{ color: "var(--ds-text-tertiary)" }}
                title={`${meta.noun} — ${origin}`}
              >
                {l.manuallyOverridden ? null : <Sparkle size={9} weight="duotone" />}
                {origin}
              </span>
              <button
                type="button"
                onClick={() => detach(l.labelId, l.name)}
                disabled={pending}
                className="rounded p-0.5 text-[var(--ds-text-tertiary)] hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text)] disabled:opacity-50"
                aria-label={`Détacher ${l.name}`}
                title="Détacher — le libellé Gmail sera retiré et ne reviendra pas"
              >
                <X size={11} weight="bold" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
