import { z } from "zod";
import { addressSchema, currencyCode, isoDate, money, quantity } from "./common";

/**
 * Canonical invoice (outbound).
 *
 * The app builds this when the user invoices a shipped order and POSTs it to
 * Tediware, which maps and generates the 810 Invoice. Amounts are stated plainly
 * (line totals, subtotal, total); tax and allowance/charge modeling is left out
 * on purpose and would be added generically here only if a real need appears,
 * never to satisfy one retailer's spec.
 */

export const invoiceLineSchema = z.object({
  /** Matches the order line being billed. */
  lineNumber: z.number().int().positive(),
  sku: z.string().min(1),
  /** Retailer's item number for the same product, when known from the order. */
  buyerItemNumber: z.string().min(1).optional(),
  description: z.string().min(1),
  quantityInvoiced: quantity,
  unitOfMeasure: z.string().min(1),
  unitPrice: money,
  /** quantityInvoiced * unitPrice, in the invoice currency. */
  lineTotal: money,
});
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

export const canonicalInvoiceSchema = z.object({
  /** The purchase order being billed. */
  poNumber: z.string().min(1),
  /** Date of the purchase order being billed. */
  orderDate: isoDate,
  /** The number the retailer assigned to us as a supplier, from the order. */
  vendorNumber: z.string().min(1).optional(),
  /** Supplier-generated invoice identifier. */
  invoiceNumber: z.string().min(1),
  invoiceDate: isoDate,
  /** Where the billed goods were delivered, copied from the order. */
  shipTo: addressSchema,
  /** The shipment this invoice bills for, if the app is tracking one. */
  shipmentNumber: z.string().optional(),
  currency: currencyCode.default("USD"),
  /** Net payment terms in days, e.g. 30. Omitted if not stated. */
  paymentTermsDays: z.number().int().nonnegative().optional(),
  lineItems: z.array(invoiceLineSchema).min(1),
  /** Sum of line totals. */
  subtotal: money,
  /** Amount due. Equals subtotal until tax/charges are modeled. */
  total: money,
});
export type CanonicalInvoice = z.infer<typeof canonicalInvoiceSchema>;
