"use client";

import { ArrowCounterClockwise, FloppyDisk } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { setBillingTerms } from "@/lib/actions/invoices";
import {
  DUE_DATE_OPTION_LABELS,
  type DueDateOption,
  type ResolvedBillingTerms,
} from "@/lib/billing/billing-terms";

/** Valeur de `Select` représentant « garder le défaut de la marque ». */
const INHERIT = "__inherit__";

type Props = {
  /** L'un des deux, pas les deux. */
  projectId?: string;
  coworkingContractId?: string;
  /** Libellé de la marque, pour nommer ce dont on hérite. */
  brandLabel: string;
  /** Conditions négociées déjà enregistrées, telles qu'en base. */
  terms: {
    paymentTerms?: string;
    dueDateOption?: DueDateOption;
    footerOthers?: string[];
    thankYouNote?: string | null;
  };
  /** Ce qui s'appliquera réellement, défauts de marque compris. */
  effective: ResolvedBillingTerms;
};

/**
 * Édition des conditions de facturation d'un deal.
 *
 * Chaque champ laissé vide retombe sur le défaut de la marque — le formulaire
 * le dit explicitement, parce que « vide » et « vide imposé » n'ont pas le même
 * effet sur la facture. La seule exception est la note de bas de document, où
 * l'on peut vouloir l'effacer alors que la marque en met une : d'où la case
 * dédiée plutôt qu'un champ vide ambigu.
 */
export function BillingTermsForm({
  projectId,
  coworkingContractId,
  brandLabel,
  terms,
  effective,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [paymentTerms, setPaymentTerms] = useState(terms.paymentTerms ?? "");
  const [dueDateOption, setDueDateOption] = useState<string>(terms.dueDateOption ?? INHERIT);
  const [footer, setFooter] = useState((terms.footerOthers ?? []).join("\n"));
  const [thankYouNote, setThankYouNote] = useState(terms.thankYouNote ?? "");
  const [clearNote, setClearNote] = useState(terms.thankYouNote === null);

  function save(reset = false) {
    startTransition(async () => {
      const res = await setBillingTerms(
        reset
          ? { projectId, coworkingContractId }
          : {
              projectId,
              coworkingContractId,
              paymentTerms: paymentTerms.trim() || undefined,
              dueDateOption:
                dueDateOption === INHERIT ? undefined : (dueDateOption as DueDateOption),
              footerOthers: footer
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean),
              thankYouNote: clearNote ? undefined : thankYouNote.trim() || undefined,
              clearThankYouNote: clearNote,
            },
      );
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if (reset) {
        setPaymentTerms("");
        setDueDateOption(INHERIT);
        setFooter("");
        setThankYouNote("");
        setClearNote(false);
      }
      toast.success(
        reset
          ? `Conditions remises aux défauts ${brandLabel}.`
          : res.data.hasTerms
            ? "Conditions enregistrées."
            : `Aucune condition propre : défauts ${brandLabel} appliqués.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        Un champ laissé vide reprend le défaut de la marque {brandLabel}. Ces conditions
        s'appliquent au devis et à toutes les factures de ce deal.
      </p>

      <div className="space-y-2">
        <Label htmlFor="paymentTerms">Modalités de paiement</Label>
        <Textarea
          id="paymentTerms"
          rows={2}
          value={paymentTerms}
          onChange={(e) => setPaymentTerms(e.target.value)}
          placeholder={effective.document.paymentTerms ?? `Défaut ${brandLabel}`}
          disabled={pending}
        />
        <p className="text-[11px] text-muted-foreground">
          Texte imprimé sur la facture. Ex. « 30 % à la commande, solde à la livraison ».
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="dueDateOption">Échéance</Label>
        <Select value={dueDateOption} onValueChange={setDueDateOption} disabled={pending}>
          <SelectTrigger id="dueDateOption">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT}>
              Défaut {brandLabel} (
              {
                DUE_DATE_OPTION_LABELS[
                  (effective.document.dueDateOption as DueDateOption) ?? "DAYS_30"
                ]
              }
              )
            </SelectItem>
            {(Object.keys(DUE_DATE_OPTION_LABELS) as DueDateOption[]).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {DUE_DATE_OPTION_LABELS[opt]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Pilote à la fois l'échéance imprimée sur la facture et le délai de relance. Seules ces
          trois valeurs sont acceptées par Dougs — 45 jours n'est pas possible.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="footerOthers">Mentions de pied / CGV</Label>
        <Textarea
          id="footerOthers"
          rows={3}
          value={footer}
          onChange={(e) => setFooter(e.target.value)}
          placeholder={(effective.document.footerOthers ?? []).join("\n") || `Défaut ${brandLabel}`}
          disabled={pending}
        />
        <p className="text-[11px] text-muted-foreground">Une mention par ligne, 5 au maximum.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="thankYouNote">Note de bas de document</Label>
        <Textarea
          id="thankYouNote"
          rows={2}
          value={clearNote ? "" : thankYouNote}
          onChange={(e) => setThankYouNote(e.target.value)}
          placeholder={effective.document.thankYouNote ?? `Défaut ${brandLabel}`}
          disabled={pending || clearNote}
        />
        <Label
          htmlFor="clearThankYouNote"
          className="flex items-center gap-2 font-normal text-[11px] text-muted-foreground"
        >
          <Input
            id="clearThankYouNote"
            type="checkbox"
            className="size-3.5"
            checked={clearNote}
            onChange={(e) => setClearNote(e.target.checked)}
            disabled={pending}
          />
          Aucune note sur ce deal, même si la marque en prévoit une
        </Label>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => save(false)}>
          <FloppyDisk className="mr-1.5 size-4" />
          Enregistrer
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => save(true)}>
          <ArrowCounterClockwise className="mr-1.5 size-4" />
          Revenir aux défauts {brandLabel}
        </Button>
      </div>
    </div>
  );
}
