"use client";

import { Button } from "@/components/ui/button";
import { pushCoworkingInvoiceToDougs } from "@/lib/actions/coworking";
import { ExternalLink, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

type Props = {
  invoiceId: string;
  /** Si déjà poussé : id Dougs pour afficher le lien plutôt que le bouton. */
  dougsInvoiceId: string | null;
  /** URL Dougs pré-calculée côté serveur (companyId stocké en session). */
  dougsUrl: string | null;
};

export function PushToDougsButton({ invoiceId, dougsInvoiceId, dougsUrl }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function push() {
    startTransition(async () => {
      const res = await pushCoworkingInvoiceToDougs({ id: invoiceId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Brouillon créé sur Dougs (${res.data.reference}).`);
      router.refresh();
      // Ouvre directement le brouillon pour vérification.
      window.open(res.data.url, "_blank", "noopener");
    });
  }

  if (dougsInvoiceId && dougsUrl) {
    return (
      <a
        href={dougsUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-muted-foreground text-sm hover:bg-muted"
      >
        <ExternalLink className="size-3.5" />
        Voir sur Dougs
      </a>
    );
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={push} disabled={pending}>
      <Send className="mr-1 size-4" />
      {pending ? "Push…" : "Pousser sur Dougs"}
    </Button>
  );
}
