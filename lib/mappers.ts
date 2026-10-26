import type { Order, OrderLine } from "@/db/schema";
import {
  canonicalShipmentSchema,
  type Address,
  round2,
  type CanonicalOrder,
  type CanonicalShipment,
  type InvoiceLine,
} from "@/lib/schemas";

/** The order's stored ship-to columns as a canonical address. */
export function orderShipTo(order: Order): Address {
  return {
    name: order.shipToName,
    address1: order.shipToAddress1,
    address2: order.shipToAddress2 ?? undefined,
    city: order.shipToCity,
    state: order.shipToState,
    postalCode: order.shipToPostalCode,
    country: order.shipToCountry,
    locationId: order.shipToLocationId ?? undefined,
  };
}

/**
 * Rebuilds the canonical order shape from stored columns, for the document
 * viewer. When a real inbound delivery exists, prefer the raw fetched payload
 * (received_documents.rawFetchedPayload); this reconstruction is the fallback
 * for seed orders that never came through a webhook.
 */
export function orderToCanonical(
  order: Order,
  lines: OrderLine[],
): CanonicalOrder {
  return {
    poNumber: order.poNumber,
    partner: order.partner,
    orderDate: order.orderDate,
    vendorNumber: order.vendorNumber ?? undefined,
    requestedShipDate: order.requestedShipDate ?? null,
    currency: order.currency,
    shipTo: orderShipTo(order),
    lineItems: lines.map((l) => ({
      lineNumber: l.lineNumber,
      sku: l.sku,
      buyerItemNumber: l.buyerItemNumber ?? undefined,
      description: l.description,
      quantityOrdered: l.quantityOrdered,
      unitOfMeasure: l.unitOfMeasure,
      unitPrice: l.unitPrice,
    })),
    notes: order.notes ?? undefined,
  };
}

/**
 * Recovers the canonical shipment from a stored submission payload. Null when
 * there is no payload or it no longer parses (e.g. the schema evolved).
 */
export function parseShipmentPayload(
  requestPayload: string | null | undefined,
): CanonicalShipment | null {
  if (!requestPayload) return null;
  const parsed = canonicalShipmentSchema.safeParse(
    (() => {
      try {
        return JSON.parse(requestPayload);
      } catch {
        return null;
      }
    })(),
  );
  return parsed.success ? parsed.data : null;
}

/**
 * Invoice lines bill what shipped, not what was ordered: a partially shipped
 * line bills the shipped quantity, and a line left out of the shipment is not
 * billed. Without a recoverable shipment the ordered quantities are the only
 * information available, so they are used as the fallback.
 */
export function buildInvoiceLines(
  lines: OrderLine[],
  shipment: CanonicalShipment | null,
): InvoiceLine[] {
  const shipped = new Map(
    shipment?.lineItems.map((l) => [l.lineNumber, l.quantityShipped]) ?? [],
  );
  return lines
    .map((l) => {
      const quantity = shipment
        ? (shipped.get(l.lineNumber) ?? 0)
        : l.quantityOrdered;
      return {
        lineNumber: l.lineNumber,
        sku: l.sku,
        buyerItemNumber: l.buyerItemNumber ?? undefined,
        description: l.description,
        quantityInvoiced: quantity,
        unitOfMeasure: l.unitOfMeasure,
        unitPrice: l.unitPrice,
        lineTotal: round2(quantity * l.unitPrice),
      };
    })
    .filter((l) => l.quantityInvoiced > 0);
}
