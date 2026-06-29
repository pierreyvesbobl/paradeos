"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getContactPreview } from "@/lib/actions/contacts";
import { ContactName, EntityName } from "@/lib/demo/components";
import { useDemoMode } from "@/lib/demo/context";
import {
  ArrowSquareOut,
  Buildings,
  EnvelopeSimple,
  LinkedinLogo,
  Phone,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LinkGlyph, type LinkItem } from "../link-field/link-chip";

type Preview = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  linkedinUrl: string | null;
  notes: string | null;
  entityId: string | null;
  entityName: string | null;
};

/**
 * Aperçu compact d'un contact en panneau latéral droit (Sheet) — conforme
 * au handoff "champ de liaison" : pas un modal centré, mais une fiche
 * coulissante 360px qui préserve le contexte de la page projet.
 *
 * Le nom de l'export reste `ContactPreviewDialog` pour stabilité des
 * imports existants.
 */
export function ContactPreviewDialog({
  contactId,
  onClose,
}: {
  contactId: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const demo = useDemoMode();

  useEffect(() => {
    if (!contactId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getContactPreview({ id: contactId })
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
  }, [contactId]);

  const open = contactId !== null;
  const fullName = data ? `${data.firstName} ${data.lastName}`.trim() : "";

  const linkItem: LinkItem | null = data
    ? {
        id: data.id,
        name: fullName,
        kind: "person",
        role: data.jobTitle,
      }
    : null;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent>
        <SheetHeader
          kind="Contact"
          actions={
            data ? (
              <Link
                href={`/contacts/${data.id}`}
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
              <span className="size-12 animate-pulse rounded-full bg-muted-foreground/15" />
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
                  <SheetTitle className="truncate">
                    {demo ? <ContactName contact={data} /> : fullName}
                  </SheetTitle>
                  {data.jobTitle ? (
                    <SheetDescription className="truncate">{data.jobTitle}</SheetDescription>
                  ) : null}
                </div>
              </div>

              <dl className="mt-6 space-y-[18px]">
                {data.entityId && data.entityName ? (
                  <PeekField icon={<Buildings weight="regular" size={14} />} label="Entité">
                    <Link
                      href={`/entites/${data.entityId}`}
                      className="font-medium text-ds-text hover:underline"
                    >
                      {demo ? (
                        <EntityName entity={{ id: data.entityId, name: data.entityName }} />
                      ) : (
                        data.entityName
                      )}
                    </Link>
                  </PeekField>
                ) : null}

                {data.email ? (
                  <PeekField icon={<EnvelopeSimple weight="regular" size={14} />} label="E-mail">
                    <a href={`mailto:${data.email}`} className="hover:underline">
                      {demo ? (
                        <span className="select-none blur-sm">{data.email}</span>
                      ) : (
                        data.email
                      )}
                    </a>
                  </PeekField>
                ) : null}

                {data.phone ? (
                  <PeekField icon={<Phone weight="regular" size={14} />} label="Téléphone">
                    <a href={`tel:${data.phone}`} className="hover:underline">
                      {demo ? (
                        <span className="select-none blur-sm">{data.phone}</span>
                      ) : (
                        data.phone
                      )}
                    </a>
                  </PeekField>
                ) : null}

                {data.linkedinUrl ? (
                  <PeekField icon={<LinkedinLogo weight="regular" size={14} />} label="LinkedIn">
                    <a
                      href={data.linkedinUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="truncate hover:underline"
                    >
                      {data.linkedinUrl}
                    </a>
                  </PeekField>
                ) : null}

                {data.notes ? (
                  <div>
                    <p className="font-semibold text-[11px] text-ds-text-tertiary uppercase tracking-[0.1em]">
                      Notes
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[14px] text-ds-text">
                      {demo ? (
                        <span className="select-none blur-sm">{data.notes}</span>
                      ) : (
                        data.notes
                      )}
                    </p>
                  </div>
                ) : null}

                {!data.email && !data.phone && !data.linkedinUrl && !data.notes ? (
                  <p className="text-[13px] text-ds-text-tertiary italic">
                    Aucune coordonnée renseignée.
                  </p>
                ) : null}
              </dl>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Ligne de propriété : eyebrow 11px tertiary + valeur 14px. */
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
