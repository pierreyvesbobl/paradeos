"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getEntityPreview } from "@/lib/actions/entities";
import { ContactName } from "@/lib/demo/components";
import { useDemoMode } from "@/lib/demo/context";
import type { EntityKind } from "@/lib/schemas/entities";
import { entityKindLabels } from "@/lib/schemas/entities";
import { ArrowSquareOut, Globe, IdentificationCard, MapPin } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LinkGlyph, type LinkItem } from "../link-field/link-chip";

type Preview = {
  entity: {
    id: string;
    name: string;
    kind: EntityKind;
    website: string | null;
    siren: string | null;
    vatNumber: string | null;
    address: {
      street?: string;
      postalCode?: string;
      city?: string;
      country?: string;
    } | null;
    notes: string | null;
  };
  contactsCount: number;
  previewContacts: {
    id: string;
    firstName: string;
    lastName: string;
    jobTitle: string | null;
  }[];
};

function formatAddress(addr: Preview["entity"]["address"]): string | null {
  if (!addr) return null;
  const parts = [
    addr.street,
    [addr.postalCode, addr.city].filter(Boolean).join(" "),
    addr.country,
  ].filter((p) => p && p.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Aperçu compact d'une entité en panneau latéral droit (Sheet). Le nom
 * `EntityPreviewDialog` est conservé pour symétrie avec
 * `ContactPreviewDialog` côté API consommatrice.
 */
export function EntityPreviewDialog({
  entityId,
  onClose,
}: {
  entityId: string | null;
  onClose: () => void;
}) {
  const open = entityId !== null;
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      {entityId ? <EntityPreviewSheet entityId={entityId} open={open} /> : null}
    </Sheet>
  );
}

function EntityPreviewSheet({ entityId, open }: { entityId: string; open: boolean }) {
  const [data, setData] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const demo = useDemoMode();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getEntityPreview({ id: entityId })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(res.message);
          return;
        }
        setData(res.data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityId, open]);

  const address = data ? formatAddress(data.entity.address) : null;

  const linkItem: LinkItem | null = data
    ? {
        id: data.entity.id,
        name: data.entity.name,
        kind: "entity",
        role: entityKindLabels[data.entity.kind],
      }
    : null;

  return (
    <SheetContent>
      <SheetHeader
        kind="Entité"
        actions={
          data ? (
            <Link
              href={`/entites/${data.entity.id}`}
              aria-label="Ouvrir la fiche complète"
              className="inline-flex size-7 items-center justify-center rounded-md text-ds-text-tertiary hover:bg-ds-hover hover:text-ds-text"
            >
              <ArrowSquareOut weight="regular" size={14} />
            </Link>
          ) : null
        }
      />

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {error ? (
          <p className="text-rose-600 text-sm">{error}</p>
        ) : loading || !data || !linkItem ? (
          <div className="flex items-center gap-3">
            <span className="size-12 animate-pulse rounded-xl bg-muted-foreground/15" />
            <div className="space-y-2">
              <span className="block h-4 w-32 animate-pulse rounded bg-muted-foreground/15" />
              <span className="block h-3 w-20 animate-pulse rounded bg-muted-foreground/15" />
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <LinkGlyph item={linkItem} size={48} />
              <div className="min-w-0">
                <SheetTitle className="truncate">{data.entity.name}</SheetTitle>
                <span className="mt-0.5 inline-flex rounded-full border bg-ds-surface px-2 py-0.5 font-medium text-[11px] text-ds-text-tertiary uppercase tracking-[0.08em]">
                  {entityKindLabels[data.entity.kind]}
                </span>
              </div>
            </div>

            <dl className="mt-6 space-y-[18px]">
              {data.entity.website ? (
                <PeekField icon={<Globe weight="regular" size={14} />} label="Site web">
                  <a
                    href={data.entity.website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="truncate hover:underline"
                  >
                    {data.entity.website}
                  </a>
                </PeekField>
              ) : null}

              {data.entity.siren || data.entity.vatNumber ? (
                <PeekField
                  icon={<IdentificationCard weight="regular" size={14} />}
                  label="Identifiants"
                >
                  <span className="space-y-0.5">
                    {data.entity.siren ? (
                      <span className="block">
                        <span className="text-ds-text-tertiary">SIREN&nbsp;</span>
                        <span className="font-mono text-[13px]">{data.entity.siren}</span>
                      </span>
                    ) : null}
                    {data.entity.vatNumber ? (
                      <span className="block">
                        <span className="text-ds-text-tertiary">TVA&nbsp;</span>
                        <span className="font-mono text-[13px]">{data.entity.vatNumber}</span>
                      </span>
                    ) : null}
                  </span>
                </PeekField>
              ) : null}

              {address ? (
                <PeekField icon={<MapPin weight="regular" size={14} />} label="Adresse">
                  {address}
                </PeekField>
              ) : null}

              {data.entity.notes ? (
                <div>
                  <p className="font-semibold text-[11px] text-ds-text-tertiary uppercase tracking-[0.1em]">
                    Notes
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[14px] text-ds-text">
                    {demo ? (
                      <span className="select-none blur-sm">{data.entity.notes}</span>
                    ) : (
                      data.entity.notes
                    )}
                  </p>
                </div>
              ) : null}

              <div>
                <p className="font-semibold text-[11px] text-ds-text-tertiary uppercase tracking-[0.1em]">
                  Contacts ({data.contactsCount})
                </p>
                {data.previewContacts.length === 0 ? (
                  <p className="mt-1 text-[13px] text-ds-text-tertiary italic">
                    Aucun contact rattaché.
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-0.5">
                    {data.previewContacts.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/contacts/${c.id}`}
                          className="flex items-center justify-between rounded-sm px-1.5 py-1 hover:bg-ds-hover"
                        >
                          <ContactName contact={c} className="text-[14px] text-ds-text" />
                          {c.jobTitle ? (
                            <span className="text-[12px] text-ds-text-tertiary">{c.jobTitle}</span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                    {data.contactsCount > data.previewContacts.length ? (
                      <li className="px-1.5 py-1 text-[11px] text-ds-text-tertiary italic">
                        + {data.contactsCount - data.previewContacts.length} autres
                      </li>
                    ) : null}
                  </ul>
                )}
              </div>
            </dl>
          </>
        )}
      </div>
    </SheetContent>
  );
}

function PeekField({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="inline-flex items-center gap-1.5 font-semibold text-[11px] text-ds-text-tertiary uppercase tracking-[0.1em]">
        <span className="shrink-0">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1 text-[14px] text-ds-text">{children}</dd>
    </div>
  );
}
