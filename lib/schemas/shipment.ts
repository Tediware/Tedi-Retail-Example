import { z } from "zod";
import { addressSchema, isoDate, quantity } from "./common";

/**
 * Canonical shipment (outbound).
 *
 * The app builds this when the user ships an order and POSTs it to Tediware,
 * which maps and generates the 856 Advance Ship Notice. The app never produces
 * EDI, but it does describe the physical packing: which items went into which
 * carton, and which cartons ride on which pallet. Those are facts only the
 * supplier knows (a mapping cannot invent label barcodes or carton contents).
 *
 * The packing is shaped the way ERP and WMS systems actually export it, not
 * the way an ASN wants to consume it: item detail lives once on `lineItems`,
 * carton contents are bare line references, and the pallet hierarchy is
 * expressed by reference (`palletSscc` on the carton), not by nesting. That is
 * deliberate. Rendering a retailer's hierarchy from this - joining contents
 * back to lines for item detail, grouping cartons by pallet for a tare level,
 * aggregating counts - is the mapping's job on the Tediware side, exactly as
 * it would be for a real supplier's export.
 */

/**
 * GS1 SSCC-18: the 18-digit serial number on a carton or pallet label. SSCC is
 * supplier warehouse vocabulary (it is what the barcode on the physical label
 * encodes), not EDI vocabulary.
 */
export const ssccSchema = z.string().regex(/^\d{18}$/, "must be 18 digits");

/**
 * One quantity of an order line inside a carton. A reference, not a copy: item
 * detail (sku, description, buyer item number) lives on the shipment line this
 * points at. Lot and expiration stay here because they are facts about the
 * physical units in this carton, not about the line.
 */
export const cartonContentSchema = z.object({
  /** The shipment line (and order line) this quantity fulfills. */
  lineNumber: z.number().int().positive(),
  quantity,
  /** Lot or batch number of the units in this carton, for goods that carry one. */
  lotNumber: z.string().min(1).optional(),
  /** Expiration date of the units in this carton, for perishables. */
  expirationDate: isoDate.optional(),
});
export type CartonContent = z.infer<typeof cartonContentSchema>;

export const cartonSchema = z.object({
  /** The SSCC-18 on this carton's label. */
  sscc: ssccSchema,
  /** The pallet this carton rides on; absent for a carton shipped loose. */
  palletSscc: ssccSchema.optional(),
  contents: z.array(cartonContentSchema).min(1),
});
export type Carton = z.infer<typeof cartonSchema>;

/** A pallet is only a label; its cartons point at it via `palletSscc`. */
export const palletSchema = z.object({
  /** The SSCC-18 on this pallet's label. */
  sscc: ssccSchema,
});
export type Pallet = z.infer<typeof palletSchema>;

/** What shipped, per order line. The only place item detail appears. */
export const shipmentLineSchema = z.object({
  /** Matches the order line this shipment line fulfills. */
  lineNumber: z.number().int().positive(),
  /** Supplier's item number. */
  sku: z.string().min(1),
  /** Retailer's item number for the same product, when known from the order. */
  buyerItemNumber: z.string().min(1).optional(),
  description: z.string().min(1),
  quantityShipped: quantity,
  unitOfMeasure: z.string().min(1),
});
export type ShipmentLine = z.infer<typeof shipmentLineSchema>;

export const canonicalShipmentSchema = z
  .object({
    /** The purchase order being fulfilled. */
    poNumber: z.string().min(1),
    /** Supplier-generated identifier for this shipment. */
    shipmentNumber: z.string().min(1),
    shipDate: isoDate,
    /** When the shipment is expected to arrive. */
    estimatedDeliveryDate: isoDate.optional(),
    /** Carrier moving the goods, e.g. "UPS". Free text. */
    carrier: z.string().min(1),
    /** Standard Carrier Alpha Code for the carrier, e.g. "UPSN". */
    scac: z.string().min(2).max(4).optional(),
    trackingNumber: z.string().min(1).optional(),
    billOfLadingNumber: z.string().min(1).optional(),
    /** Total shipment weight, in `weightUnit`. */
    totalWeight: z.number().positive().optional(),
    /** Unit for `totalWeight`, e.g. "LB". Free text. */
    weightUnit: z.string().min(1).optional(),
    /** Origin address. Optional; the supplier's default warehouse if omitted. */
    shipFrom: addressSchema.optional(),
    /** Destination, normally copied from the order's shipTo. */
    shipTo: addressSchema,
    lineItems: z.array(shipmentLineSchema).min(1),
    /** Pallet labels in this shipment. Empty or absent for unpalletized freight. */
    pallets: z.array(palletSchema).optional(),
    /** Every carton in the shipment, palletized or loose. */
    cartons: z.array(cartonSchema).min(1),
  })
  .superRefine((shipment, ctx) => {
    const lines = new Map(shipment.lineItems.map((l) => [l.lineNumber, l]));
    const packed = new Map<number, number>();
    for (const carton of shipment.cartons) {
      for (const item of carton.contents) {
        if (!lines.has(item.lineNumber)) {
          ctx.addIssue({
            code: "custom",
            path: ["cartons"],
            message: `carton ${carton.sscc} references line ${item.lineNumber}, which is not in lineItems`,
          });
        }
        packed.set(
          item.lineNumber,
          (packed.get(item.lineNumber) ?? 0) + item.quantity,
        );
      }
    }
    for (const line of shipment.lineItems) {
      const total = packed.get(line.lineNumber) ?? 0;
      if (Math.abs(total - line.quantityShipped) > 1e-9) {
        ctx.addIssue({
          code: "custom",
          path: ["lineItems"],
          message: `line ${line.lineNumber}: cartons contain ${total}, lineItems say ${line.quantityShipped}`,
        });
      }
    }

    const palletLabels = new Set((shipment.pallets ?? []).map((p) => p.sscc));
    const referenced = new Set<string>();
    for (const carton of shipment.cartons) {
      if (carton.palletSscc === undefined) continue;
      if (!palletLabels.has(carton.palletSscc)) {
        ctx.addIssue({
          code: "custom",
          path: ["cartons"],
          message: `carton ${carton.sscc} references pallet ${carton.palletSscc}, which is not in pallets`,
        });
      }
      referenced.add(carton.palletSscc);
    }
    for (const label of palletLabels) {
      if (!referenced.has(label)) {
        ctx.addIssue({
          code: "custom",
          path: ["pallets"],
          message: `pallet ${label} has no cartons`,
        });
      }
    }

    const labels = [
      ...(shipment.pallets ?? []).map((p) => p.sscc),
      ...shipment.cartons.map((c) => c.sscc),
    ];
    if (new Set(labels).size !== labels.length) {
      ctx.addIssue({
        code: "custom",
        path: ["cartons"],
        message: "SSCC labels must be unique across all pallets and cartons",
      });
    }
  });
export type CanonicalShipment = z.infer<typeof canonicalShipmentSchema>;
