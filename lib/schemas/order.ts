import { z } from "zod";
import { addressSchema, currencyCode, isoDate, money, quantity } from "./common";

/**
 * Canonical order (inbound).
 *
 * The app's own idea of "an order arrived". Tediware's inbound mapping targets
 * an 850 implementation, so what the platform delivers is X12-shaped JSON that
 * is stable across partners and releases; `lib/tediware/inbound-order.ts`
 * translates that into this shape. Retailer #2 must be absorbable by
 * Tediware-side mapping config plus that qualifier-generic translator with no
 * change here, so keep every field generic to "a retailer sent us an order".
 */

export const orderLineSchema = z.object({
  /** Line position within the order, 1-based. */
  lineNumber: z.number().int().positive(),
  /** The supplier's own item number for the product. */
  sku: z.string().min(1),
  /** The retailer's item number for the same product, if they sent one. */
  buyerItemNumber: z.string().optional(),
  description: z.string().min(1),
  quantityOrdered: quantity,
  /** Unit the quantity is counted in, e.g. "EA" (each), "CS" (case). Free text; retailers differ. */
  unitOfMeasure: z.string().min(1),
  /** Price per unit in the order's currency. */
  unitPrice: money,
});
export type OrderLine = z.infer<typeof orderLineSchema>;

export const canonicalOrderSchema = z.object({
  /** The retailer's purchase order number. Unique per partner. */
  poNumber: z.string().min(1),
  /** Trading partner this order came from, e.g. "petco". */
  partner: z.string().min(1),
  orderDate: isoDate,
  /**
   * The number this retailer assigned to us as a supplier, if the order
   * carried it. Retailers expect it echoed on the invoice.
   */
  vendorNumber: z.string().min(1).optional(),
  /** Date the retailer wants the goods shipped, if specified. */
  requestedShipDate: isoDate.nullable().optional(),
  currency: currencyCode.default("USD"),
  /** Where the goods should be delivered. */
  shipTo: addressSchema,
  lineItems: z.array(orderLineSchema).min(1),
  /** Free-text instructions from the retailer, if any. */
  notes: z.string().optional(),
});
export type CanonicalOrder = z.infer<typeof canonicalOrderSchema>;
