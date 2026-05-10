"use client";

import { Button } from "@/components/ui/button";
import { generateNextCoworkingInvoice } from "@/lib/actions/coworking";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

type Props = {
  contractId: string;
};

/**
 * Bouton qui crée la facture suivante (statut `a_facturer`) depuis la
 * cadence du contrat. Période auto = lendemain de la dernière facture
 * (ou contract.startDate si aucune) + N mois selon billing_frequency.
 */
export function NextInvoiceButton({ contractId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function generate() {
    startTransition(async () => {
      const res = await generateNextCoworkingInvoice({ contractId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Facture suivante générée.");
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={generate}
      disabled={pending}
      title="Génère la facture suivante (période auto)"
    >
      <Sparkles className="mr-1 size-4" />
      {pending ? "Génération…" : "Facture suivante"}
    </Button>
  );
}
