import "server-only";

import { desc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/db";
import type {
  DeliveryNotification,
  Invoice,
  Order,
  OrderLine,
  OutboundSubmission,
  ReceivedDocument,
  Shipment,
} from "@/db/schema";

/**
 * Where an accepted submission stands after Tediware queued it: delivered or
 * failed once a delivery notification arrived on its trace, pending until
 * then. The latest notification wins, so a failure followed by a successful
 * resend reads as delivered.
 */
export type Delivery = {
  status: "pending" | "delivered" | "failed";
  notification: DeliveryNotification | null;
};

/**
 * Delivery state per submission id. Submissions that were never queued
 * (rejected, transport error, or stubbed with no trace) have no entry.
 */
function deliveriesFor(
  submissions: OutboundSubmission[],
): Record<number, Delivery> {
  const traces = submissions
    .filter((s) => s.outcome === "accepted" && s.traceGuid)
    .map((s) => s.traceGuid!);
  const latestByTrace = new Map<string, DeliveryNotification>();
  if (traces.length > 0) {
    const notifications = db
      .select()
      .from(schema.deliveryNotifications)
      .where(inArray(schema.deliveryNotifications.traceGuid, traces))
      .orderBy(schema.deliveryNotifications.id)
      .all();
    for (const n of notifications) latestByTrace.set(n.traceGuid!, n);
  }

  const deliveries: Record<number, Delivery> = {};
  for (const s of submissions) {
    if (s.outcome !== "accepted" || !s.traceGuid) continue;
    const notification = latestByTrace.get(s.traceGuid) ?? null;
    deliveries[s.id] = {
      status: !notification
        ? "pending"
        : notification.role === "error"
          ? "failed"
          : "delivered",
      notification,
    };
  }
  return deliveries;
}

/** All orders, newest first, for the inbox. */
export function listOrders(): Order[] {
  return db.select().from(schema.orders).orderBy(desc(schema.orders.id)).all();
}

export type OrderDetail = {
  order: Order;
  lines: OrderLine[];
  shipment: Shipment | null;
  invoice: Invoice | null;
  submissions: OutboundSubmission[];
  deliveries: Record<number, Delivery>;
  receivedDocument: ReceivedDocument | null;
};

/** Everything the order detail page needs, or null if the id does not exist. */
export function getOrderDetail(orderId: number): OrderDetail | null {
  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .get();
  if (!order) return null;

  const lines = db
    .select()
    .from(schema.orderLines)
    .where(eq(schema.orderLines.orderId, orderId))
    .orderBy(schema.orderLines.lineNumber)
    .all();

  const shipment =
    db
      .select()
      .from(schema.shipments)
      .where(eq(schema.shipments.orderId, orderId))
      .get() ?? null;

  const invoice =
    db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.orderId, orderId))
      .get() ?? null;

  const submissions = db
    .select()
    .from(schema.outboundSubmissions)
    .where(eq(schema.outboundSubmissions.orderId, orderId))
    .orderBy(desc(schema.outboundSubmissions.id))
    .all();

  const receivedDocument =
    db
      .select()
      .from(schema.receivedDocuments)
      .where(eq(schema.receivedDocuments.orderId, orderId))
      .get() ?? null;

  return {
    order,
    lines,
    shipment,
    invoice,
    submissions,
    deliveries: deliveriesFor(submissions),
    receivedDocument,
  };
}

export type ActivityFeed = {
  received: ReceivedDocument[];
  submissions: OutboundSubmission[];
  deliveries: Record<number, Delivery>;
  /** Error notifications that match no submission, e.g. an inbound flow failing. */
  unmatchedErrors: DeliveryNotification[];
};

/** Reverse-chronological inbound deliveries and outbound submissions for the log. */
export function getActivity(): ActivityFeed {
  const received = db
    .select()
    .from(schema.receivedDocuments)
    .orderBy(desc(schema.receivedDocuments.id))
    .all();
  const submissions = db
    .select()
    .from(schema.outboundSubmissions)
    .orderBy(desc(schema.outboundSubmissions.id))
    .all();
  const traces = new Set(
    submissions.map((s) => s.traceGuid).filter((t): t is string => !!t),
  );
  const unmatchedErrors = db
    .select()
    .from(schema.deliveryNotifications)
    .where(eq(schema.deliveryNotifications.role, "error"))
    .orderBy(desc(schema.deliveryNotifications.id))
    .all()
    .filter((n) => !n.traceGuid || !traces.has(n.traceGuid));
  return {
    received,
    submissions,
    deliveries: deliveriesFor(submissions),
    unmatchedErrors,
  };
}
