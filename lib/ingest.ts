import "server-only";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { round2, type CanonicalOrder } from "@/lib/schemas";

/**
 * Turns a canonical order into rows. Idempotent on (partner, poNumber): a
 * repeated ingest of the same PO returns the existing order rather than
 * duplicating it, which backs the webhook's replay safety alongside the
 * result_extid guard.
 */
export function ingestOrder(order: CanonicalOrder): {
  orderId: number;
  created: boolean;
} {
  const existing = db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.partner, order.partner),
        eq(schema.orders.poNumber, order.poNumber),
      ),
    )
    .get();
  if (existing) return { orderId: existing.id, created: false };

  const orderTotal = round2(
    order.lineItems.reduce((sum, l) => sum + l.quantityOrdered * l.unitPrice, 0),
  );

  const orderId = db.transaction((tx) => {
    const [row] = tx
      .insert(schema.orders)
      .values({
        poNumber: order.poNumber,
        partner: order.partner,
        status: "received",
        orderDate: order.orderDate,
        vendorNumber: order.vendorNumber ?? null,
        requestedShipDate: order.requestedShipDate ?? null,
        currency: order.currency,
        shipToName: order.shipTo.name,
        shipToAddress1: order.shipTo.address1,
        shipToAddress2: order.shipTo.address2 ?? null,
        shipToCity: order.shipTo.city,
        shipToState: order.shipTo.state,
        shipToPostalCode: order.shipTo.postalCode,
        shipToCountry: order.shipTo.country,
        shipToLocationId: order.shipTo.locationId ?? null,
        orderTotal,
        notes: order.notes ?? null,
      })
      .returning({ id: schema.orders.id })
      .all();

    tx.insert(schema.orderLines)
      .values(
        order.lineItems.map((l) => ({
          orderId: row.id,
          lineNumber: l.lineNumber,
          sku: l.sku,
          buyerItemNumber: l.buyerItemNumber ?? null,
          description: l.description,
          quantityOrdered: l.quantityOrdered,
          unitOfMeasure: l.unitOfMeasure,
          unitPrice: l.unitPrice,
        })),
      )
      .run();

    return row.id;
  });

  return { orderId, created: true };
}
