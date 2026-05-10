"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { useState } from "react";
import { InvoiceForm } from "./invoice-form";

type Props = {
  contractId: string;
  defaultName: string;
  defaultDesks: number;
  defaultUnitPriceHt: string;
};

export function NewInvoiceButton({
  contractId,
  defaultName,
  defaultDesks,
  defaultUnitPriceHt,
}: Props) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-1 size-4" /> Nouvelle facture
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Nouvelle facture</DialogTitle>
        </DialogHeader>
        <InvoiceForm
          mode="create"
          defaultValues={{
            contractId,
            name: defaultName,
            invoiceDate: fmt(today),
            periodStart: fmt(firstOfMonth),
            periodEnd: fmt(lastOfMonth),
            status: "a_facturer",
            billedBy: "parade",
            desks: defaultDesks,
            unitPriceHt: defaultUnitPriceHt,
            vatRate: "0.2",
            notes: "",
          }}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
