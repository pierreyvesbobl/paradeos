"use client";

import { CompanySearch } from "@/components/gouv/company-search";
import { Button } from "@/components/ui/button";
import { patchEntity } from "@/lib/actions/entities";
import { lookupCompanies } from "@/lib/actions/gouv";
import { useDemoMode } from "@/lib/demo/context";
import type { SireneCompany } from "@/lib/gouv/sirene";
import { DownloadSimple } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

type Address = {
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
} | null;

type Props = {
  id: string;
  current: {
    siren: string | null;
    siret: string | null;
    vatNumber: string | null;
    legalName: string | null;
    address: Address;
  };
};

const FIELD_LABELS = {
  siren: "SIREN",
  siret: "SIRET",
  vatNumber: "TVA",
  legalName: "dénomination sociale",
  address: "adresse",
} as const;

function isAddressEmpty(address: Address): boolean {
  if (!address) return true;
  return !(address.street || address.postalCode || address.city);
}

/**
 * Complète une fiche entité depuis l'annuaire des entreprises, sur la
 * page de détail. Ne touche **que les champs vides** : ce qui a été saisi
 * à la main fait foi, l'INSEE ne vient pas par-dessus. Pour corriger une
 * valeur existante, l'édition inline reste la voie normale.
 */
export function EntitySireneFill({ id, current }: Props) {
  const router = useRouter();
  const demo = useDemoMode();
  const [pending, setPending] = useState(false);

  // En démo, les données sont floutées : proposer d'aller chercher la vraie
  // fiche INSEE n'aurait pas de sens.
  if (demo) return null;

  async function apply(company: SireneCompany) {
    const patch: Record<string, unknown> = {};
    if (!current.siren) patch.siren = company.siren;
    if (!current.siret && company.siret) patch.siret = company.siret;
    if (!current.vatNumber && company.vatNumber) patch.vatNumber = company.vatNumber;
    if (!current.legalName && company.legalName) patch.legalName = company.legalName;
    if (isAddressEmpty(current.address) && company.address) patch.address = company.address;

    const filled = Object.keys(patch);
    if (filled.length === 0) {
      toast.info("Rien à compléter : tous les champs sont déjà renseignés.");
      return;
    }

    setPending(true);
    try {
      const res = await patchEntity({ id, ...patch });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const labels = filled.map((f) => FIELD_LABELS[f as keyof typeof FIELD_LABELS]);
      toast.success(`Complété depuis l'INSEE : ${labels.join(", ")}.`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  // Avec un SIREN déjà en fiche, pas besoin de faire chercher : il identifie
  // l'entreprise à lui seul.
  if (current.siren) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const res = await lookupCompanies({ query: current.siren ?? "" });
          setPending(false);
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          const company = res.data.find((c) => c.siren === current.siren) ?? res.data[0];
          if (!company) {
            toast.error(`Aucune entreprise au SIREN ${current.siren} dans l'annuaire.`);
            return;
          }
          await apply(company);
        }}
      >
        <DownloadSimple className="size-3.5" />
        {pending ? "Interrogation de l'INSEE…" : "Compléter depuis l'INSEE"}
      </Button>
    );
  }

  return <CompanySearch onPick={apply} disabled={pending} className="max-w-sm" />;
}
