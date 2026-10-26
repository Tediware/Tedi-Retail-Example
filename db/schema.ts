import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * SQLite schema (Drizzle).
 *
 * Convention: columns holding a Tediware-side identifier use the `_extid`
 * suffix, never `_id`, so foreign-system ids stay visually distinct from our own
 * autoincrement ids. Dates and timestamps are stored as ISO strings for
 * readability; money is stored as a real (a deliberately naive choice).
 */

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** One purchase order, as received from a retailer via Tediware. */
export const orders = sqliteTable(
  "orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    poNumber: text("po_number").notNull(),
    partner: text("partner").notNull(),
    status: text("status", { enum: ["received", "shipped", "invoiced"] })
      .notNull()
      .default("received"),
    orderDate: text("order_date").notNull(),
    vendorNumber: text("vendor_number"),
    requestedShipDate: text("requested_ship_date"),
    currency: text("currency").notNull().default("USD"),
    shipToName: text("ship_to_name").notNull(),
    shipToAddress1: text("ship_to_address1").notNull(),
    shipToAddress2: text("ship_to_address2"),
    shipToCity: text("ship_to_city").notNull(),
    shipToState: text("ship_to_state").notNull(),
    shipToPostalCode: text("ship_to_postal_code").notNull(),
    shipToCountry: text("ship_to_country").notNull().default("US"),
    shipToLocationId: text("ship_to_location_id"),
    orderTotal: real("order_total").notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    // A PO number is unique within a trading partner. This also gives inbound
    // order creation a natural idempotency key.
    uniqueIndex("orders_partner_po_unq").on(t.partner, t.poNumber),
  ],
);

/** Line items belonging to an order. */
export const orderLines = sqliteTable("order_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  lineNumber: integer("line_number").notNull(),
  sku: text("sku").notNull(),
  buyerItemNumber: text("buyer_item_number"),
  description: text("description").notNull(),
  quantityOrdered: real("quantity_ordered").notNull(),
  unitOfMeasure: text("unit_of_measure").notNull(),
  unitPrice: real("unit_price").notNull(),
});

/**
 * Audit log of every outbound POST to Tediware (856, 810). The full canonical
 * request payload and the raw response live here; shipments and invoices link
 * back to the row that carried them.
 */
export const outboundSubmissions = sqliteTable("outbound_submissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").references(() => orders.id, {
    onDelete: "set null",
  }),
  tsCode: text("ts_code", { enum: ["856", "810"] }).notNull(),
  requestPayload: text("request_payload").notNull(),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  // How Tediware answered: accepted (queued), rejected on request validation,
  // or a transport error. Delivery itself is asynchronous.
  outcome: text("outcome", { enum: ["accepted", "rejected", "error"] }).notNull(),
  // Tediware's trace GUID for this submission; links to its async processing
  // results (delivery confirmation or error).
  traceGuid: text("trace_guid"),
  submittedAt: text("submitted_at").notNull().default(now),
});

/** One shipment (856) for an order. Header only; the full JSON is on the submission. */
export const shipments = sqliteTable("shipments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  shipmentNumber: text("shipment_number").notNull(),
  shippedAt: text("shipped_at").notNull(),
  carrier: text("carrier").notNull(),
  trackingNumber: text("tracking_number"),
  submissionId: integer("submission_id").references(() => outboundSubmissions.id),
  createdAt: text("created_at").notNull().default(now),
});

/** One invoice (810) for an order. Header only; the full JSON is on the submission. */
export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  invoiceNumber: text("invoice_number").notNull(),
  invoicedAt: text("invoiced_at").notNull(),
  total: real("total").notNull(),
  submissionId: integer("submission_id").references(() => outboundSubmissions.id),
  createdAt: text("created_at").notNull().default(now),
});

/**
 * Raw audit log of inbound webhook deliveries. The unique index on
 * `result_extid` gives webhook idempotency for free: a replayed delivery hits
 * the constraint and is acknowledged without re-processing.
 */
export const receivedDocuments = sqliteTable(
  "received_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    resultExtid: text("result_extid").notNull(),
    traceGuid: text("trace_guid"),
    requestId: text("request_id"),
    rawWebhookBody: text("raw_webhook_body").notNull(),
    rawFetchedPayload: text("raw_fetched_payload"),
    status: text("status", { enum: ["received", "processed", "failed"] })
      .notNull()
      .default("received"),
    error: text("error"),
    orderId: integer("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    receivedAt: text("received_at").notNull().default(now),
  },
  (t) => [uniqueIndex("received_documents_result_extid_unq").on(t.resultExtid)],
);

/**
 * Audit log of delivery notifications for outbound documents. A 200 on submit
 * only means Tediware queued the document; whether it reached the partner
 * arrives later on the outbound (delivered) or error webhook. Rows join to
 * outbound_submissions by trace_guid. Error notifications for inbound flows
 * land here too, with no submission to join to.
 */
export const deliveryNotifications = sqliteTable(
  "delivery_notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Which webhook it arrived on: outbound means delivered, error means failed.
    role: text("role", { enum: ["outbound", "error"] }).notNull(),
    resultExtid: text("result_extid").notNull(),
    traceGuid: text("trace_guid"),
    requestId: text("request_id"),
    rawWebhookBody: text("raw_webhook_body").notNull(),
    // The result the notification points at, as fetched from Tediware.
    rawResult: text("raw_result"),
    errorMessage: text("error_message"),
    // JSON array of individual validation errors, when the result lists them.
    errors: text("errors"),
    // Why the result could not be fetched, if it could not.
    fetchError: text("fetch_error"),
    receivedAt: text("received_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("delivery_notifications_result_extid_unq").on(t.resultExtid),
  ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderLine = typeof orderLines.$inferSelect;
export type NewOrderLine = typeof orderLines.$inferInsert;
export type Shipment = typeof shipments.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type ReceivedDocument = typeof receivedDocuments.$inferSelect;
export type OutboundSubmission = typeof outboundSubmissions.$inferSelect;
export type DeliveryNotification = typeof deliveryNotifications.$inferSelect;
