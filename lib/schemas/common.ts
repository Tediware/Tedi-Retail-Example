import { z } from "zod";

/**
 * Shared building blocks for the canonical shapes.
 *
 * These are the app's own field names, chosen the way a supplier's developer
 * would choose them: plain business language, no EDI vocabulary. Nothing here
 * should exist only because a specific retailer's spec asks for it.
 */

/** A postal address. `state` and `postalCode` are US-shaped but named generically enough to hold other regions. */
export const addressSchema = z.object({
  name: z.string().min(1),
  address1: z.string().min(1),
  address2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().min(1).default("US"),
  /**
   * The retailer's own code for this location (store or DC number), as it
   * appeared on the order. Retailers expect it echoed on documents that refer
   * back to the same place.
   */
  locationId: z.string().min(1).optional(),
});
export type Address = z.infer<typeof addressSchema>;

/** Calendar date with no time component, e.g. "2026-07-06". */
export const isoDate = z.iso.date();

/** Timestamp with timezone offset, e.g. "2026-07-06T14:30:00Z". */
export const isoDateTime = z.iso.datetime({ offset: true });

/** Three-letter currency code, e.g. "USD". */
export const currencyCode = z.string().length(3);

/** A count of goods. Fractional units are allowed (some goods sell by weight). */
export const quantity = z.number().nonnegative();

/**
 * A monetary amount as a decimal number in the document's currency (e.g. 12.50).
 * Kept as a plain number for readability; this is a naive-supplier choice, not a
 * precision guarantee.
 */
export const money = z.number();

/** Rounds a computed amount to cents, keeping float dust out of stored totals. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
