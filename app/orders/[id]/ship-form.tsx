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
import { shipOrder } from "./actions";

type LineInput = {
  lineNumber: number;
  sku: string;
  description: string;
  quantityOrdered: number;
  unitOfMeasure: string;
};

export function ShipForm({
  orderId,
  poNumber,
  lines,
}: {
  orderId: number;
  poNumber: string;
  lines: LineInput[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await shipOrder(orderId, formData);
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
      <DialogTrigger
        render={<Button>Ship</Button>}
      />
      <DialogContent className="sm:max-w-lg">
        <form action={onSubmit}>
          <DialogHeader>
            <DialogTitle>Ship order {poNumber}</DialogTitle>
            <DialogDescription>
              Builds the shipment (856) and submits it to Tediware.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="carrier">Carrier</Label>
                <Input id="carrier" name="carrier" defaultValue="UPS" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="scac">SCAC</Label>
                <Input
                  id="scac"
                  name="scac"
                  defaultValue="UPSN"
                  maxLength={4}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="shipDate">Ship date</Label>
                <Input
                  id="shipDate"
                  name="shipDate"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="estimatedDeliveryDate">Estimated delivery</Label>
                <Input
                  id="estimatedDeliveryDate"
                  name="estimatedDeliveryDate"
                  type="date"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="trackingNumber">Tracking number</Label>
                <Input
                  id="trackingNumber"
                  name="trackingNumber"
                  placeholder="Optional"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="billOfLadingNumber">Bill of lading</Label>
                <Input
                  id="billOfLadingNumber"
                  name="billOfLadingNumber"
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Packing</Label>
              <div className="grid grid-cols-3 gap-4">
                <div className="grid gap-2">
                  <Label
                    htmlFor="cartonCount"
                    className="text-xs font-normal text-muted-foreground"
                  >
                    Cartons
                  </Label>
                  <Input
                    id="cartonCount"
                    name="cartonCount"
                    type="number"
                    min={1}
                    step={1}
                    defaultValue={lines.length}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label
                    htmlFor="palletCount"
                    className="text-xs font-normal text-muted-foreground"
                  >
                    Pallets
                  </Label>
                  <Input
                    id="palletCount"
                    name="palletCount"
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={0}
                  />
                </div>
                <div className="grid gap-2">
                  <Label
                    htmlFor="totalWeight"
                    className="text-xs font-normal text-muted-foreground"
                  >
                    Weight (lb)
                  </Label>
                  <Input
                    id="totalWeight"
                    name="totalWeight"
                    type="number"
                    min={0}
                    step="any"
                    placeholder="Optional"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Quantities are split evenly across cartons. Zero pallets ships
                loose cartons; otherwise cartons are stacked onto pallets. SSCC
                labels are generated.
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Quantities shipped</Label>
              <div className="rounded-lg border divide-y">
                {lines.map((line) => (
                  <div
                    key={line.lineNumber}
                    className="flex items-center gap-3 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {line.sku}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {line.description}
                      </div>
                    </div>
                    <Input
                      name={`qty_${line.lineNumber}`}
                      type="number"
                      min={0}
                      step="any"
                      defaultValue={line.quantityOrdered}
                      className="w-24 text-right tabular-nums"
                      aria-label={`Quantity shipped for ${line.sku}`}
                    />
                    <span className="w-8 text-xs text-muted-foreground">
                      {line.unitOfMeasure}
                    </span>
                  </div>
                ))}
              </div>
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
              {pending ? "Submitting..." : "Submit shipment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
