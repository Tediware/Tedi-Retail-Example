"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/format";
import { invoiceOrder } from "./actions";

export function InvoiceForm({
  orderId,
  poNumber,
  currency,
  total,
}: {
  orderId: number;
  poNumber: string;
  currency: string;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await invoiceOrder(orderId, formData);
      if (result.status === "success") {
        toast.success(result.message);
        setOpen(false);
      } else {
        toast.error(result.message);
      }
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>Invoice</Button>} />
      <DialogContent className="sm:max-w-lg">
        <form action={onSubmit}>
          <DialogHeader>
            <DialogTitle>Invoice order {poNumber}</DialogTitle>
            <DialogDescription>
              Builds the invoice (810) from the shipped quantities and submits it
              to Tediware.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="invoiceNumber">Invoice number</Label>
                <Input
                  id="invoiceNumber"
                  name="invoiceNumber"
                  defaultValue={`INV-${poNumber}`}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invoiceDate">Invoice date</Label>
                <Input
                  id="invoiceDate"
                  name="invoiceDate"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="paymentTermsDays">Payment terms (net days)</Label>
              <Input
                id="paymentTermsDays"
                name="paymentTermsDays"
                type="number"
                min={0}
                defaultValue={30}
                className="w-32"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3 text-sm">
              <span className="text-muted-foreground">Invoice total</span>
              <span className="font-medium tabular-nums">
                {formatMoney(total, currency)}
              </span>
            </div>
          </div>

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={pending}>
              {pending ? "Submitting..." : "Submit invoice"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
