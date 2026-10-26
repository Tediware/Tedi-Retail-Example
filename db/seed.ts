import { eq } from "drizzle-orm";

import { db, schema } from "./index";
import { canonicalOrderSchema, canonicalShipmentSchema, round2 } from "../lib/schemas";
import type { CanonicalOrder, CanonicalShipment } from "../lib/schemas";
import { generateSscc } from "../lib/sscc";

/**
 * Seeds a few fake Petco orders so the UI is developable before any real
 * Tediware integration exists. Idempotent: it clears the tables first, so
 * `npm run db:seed` (or `db:reset`) can be run repeatedly.
 *
 * The orders are written as canonical shapes and then mapped into DB rows, the
 * same path the inbound webhook will take. One order is advanced to `shipped`
 * so the shipped state and the "ready to invoice" action are visible without
 * having to run the outbound flow first.
 */

const orderTotal = (o: CanonicalOrder) =>
  round2(o.lineItems.reduce((sum, l) => sum + l.quantityOrdered * l.unitPrice, 0));

const seedOrders: CanonicalOrder[] = [
  canonicalOrderSchema.parse({
    poNumber: "PET-100482",
    partner: "petco",
    orderDate: "2026-07-01",
    vendorNumber: "2781",
    requestedShipDate: "2026-07-11",
    currency: "USD",
    shipTo: {
      name: "Petco Distribution Center 07",
      address1: "5201 Distribution Way",
      city: "San Antonio",
      state: "TX",
      postalCode: "78218",
      country: "US",
      locationId: "1207",
    },
    lineItems: [
      {
        lineNumber: 1,
        sku: "CT-4800",
        buyerItemNumber: "PET-CT48",
        description: "Cat tree, 48 inch, gray",
        quantityOrdered: 24,
        unitOfMeasure: "EA",
        unitPrice: 42.5,
      },
      {
        lineNumber: 2,
        sku: "SB-2000",
        buyerItemNumber: "PET-SB20",
        description: "Scratching post, sisal, 20 inch",
        quantityOrdered: 60,
        unitOfMeasure: "EA",
        unitPrice: 11.75,
      },
    ],
    notes: "Deliver to dock 4. Appointment required.",
  }),
  canonicalOrderSchema.parse({
    poNumber: "PET-100517",
    partner: "petco",
    orderDate: "2026-07-03",
    vendorNumber: "2781",
    requestedShipDate: "2026-07-14",
    currency: "USD",
    shipTo: {
      name: "Petco Distribution Center 12",
      address1: "800 Commerce Parkway",
      city: "Joliet",
      state: "IL",
      postalCode: "60433",
      country: "US",
      locationId: "1212",
    },
    lineItems: [
      {
        lineNumber: 1,
        sku: "DB-0510",
        buyerItemNumber: "PET-DB05",
        description: "Dog bed, orthopedic, large",
        quantityOrdered: 36,
        unitOfMeasure: "EA",
        unitPrice: 28.0,
      },
    ],
  }),
  canonicalOrderSchema.parse({
    poNumber: "PET-100390",
    partner: "petco",
    orderDate: "2026-06-27",
    vendorNumber: "2781",
    requestedShipDate: "2026-07-07",
    currency: "USD",
    shipTo: {
      name: "Petco Distribution Center 03",
      address1: "1400 Logistics Blvd",
      city: "Reno",
      state: "NV",
      postalCode: "89506",
      country: "US",
      locationId: "1203",
    },
    lineItems: [
      {
        lineNumber: 1,
        sku: "AQ-1000",
        buyerItemNumber: "PET-AQ10",
        description: "Aquarium kit, 10 gallon",
        quantityOrdered: 18,
        unitOfMeasure: "EA",
        unitPrice: 54.0,
      },
      {
        lineNumber: 2,
        sku: "AF-0250",
        buyerItemNumber: "PET-AF02",
        description: "Aquarium filter cartridge, 3 pack",
        quantityOrdered: 48,
        unitOfMeasure: "EA",
        unitPrice: 6.25,
      },
    ],
  }),
];

function clear() {
  // Child-first so foreign keys are satisfied even with constraints on.
  db.delete(schema.shipments).run();
  db.delete(schema.invoices).run();
  db.delete(schema.outboundSubmissions).run();
  db.delete(schema.deliveryNotifications).run();
  db.delete(schema.orderLines).run();
  db.delete(schema.receivedDocuments).run();
  db.delete(schema.orders).run();
}

function insertOrder(o: CanonicalOrder): number {
  const [row] = db
    .insert(schema.orders)
    .values({
      poNumber: o.poNumber,
      partner: o.partner,
      status: "received",
      orderDate: o.orderDate,
      vendorNumber: o.vendorNumber ?? null,
      requestedShipDate: o.requestedShipDate ?? null,
      currency: o.currency,
      shipToName: o.shipTo.name,
      shipToAddress1: o.shipTo.address1,
      shipToAddress2: o.shipTo.address2 ?? null,
      shipToCity: o.shipTo.city,
      shipToState: o.shipTo.state,
      shipToPostalCode: o.shipTo.postalCode,
      shipToCountry: o.shipTo.country,
      shipToLocationId: o.shipTo.locationId ?? null,
      orderTotal: orderTotal(o),
      notes: o.notes ?? null,
    })
    .returning({ id: schema.orders.id })
    .all();

  db.insert(schema.orderLines)
    .values(
      o.lineItems.map((l) => ({
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
}

/** Advance one order to `shipped` with a recorded submission and shipment. */
function markShipped(orderId: number, order: CanonicalOrder) {
  const shipment: CanonicalShipment = canonicalShipmentSchema.parse({
    poNumber: order.poNumber,
    shipmentNumber: "1751702400",
    shipDate: "2026-07-05",
    carrier: "UPS",
    scac: "UPSN",
    trackingNumber: "1Z999AA10123456784",
    shipTo: order.shipTo,
    lineItems: order.lineItems.map((l) => ({
      lineNumber: l.lineNumber,
      sku: l.sku,
      buyerItemNumber: l.buyerItemNumber,
      description: l.description,
      quantityShipped: l.quantityOrdered,
      unitOfMeasure: l.unitOfMeasure,
    })),
    // One loose carton per line, whole line quantity in each.
    cartons: order.lineItems.map((l, i) => ({
      sscc: generateSscc(i + 1),
      contents: [{ lineNumber: l.lineNumber, quantity: l.quantityOrdered }],
    })),
  });

  const [submission] = db
    .insert(schema.outboundSubmissions)
    .values({
      orderId,
      tsCode: "856",
      requestPayload: JSON.stringify(shipment, null, 2),
      responseStatus: 200,
      responseBody: JSON.stringify({ status: "accepted", note: "seed data" }),
      outcome: "accepted",
    })
    .returning({ id: schema.outboundSubmissions.id })
    .all();

  db.insert(schema.shipments)
    .values({
      orderId,
      shipmentNumber: shipment.shipmentNumber,
      shippedAt: shipment.shipDate,
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber ?? null,
      submissionId: submission.id,
    })
    .run();

  db.update(schema.orders)
    .set({ status: "shipped" })
    .where(eq(schema.orders.id, orderId))
    .run();
}

clear();
const ids = seedOrders.map(insertOrder);
// Advance the oldest order (index 2) to shipped so an invoice action is ready.
markShipped(ids[2], seedOrders[2]);

console.log(`Seeded ${ids.length} orders (1 shipped, 2 received).`);
