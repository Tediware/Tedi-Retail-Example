"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/db";
import { tediwareErrorMessage } from "@/lib/format";
import {
  buildInvoiceLines,
  orderShipTo,
  parseShipmentPayload,
} from "@/lib/mappers";
import {
  canonicalInvoiceSchema,
  canonicalShipmentSchema,
  round2,
  type CanonicalInvoice,
  type CanonicalShipment,
  type Carton,
  type CartonContent,
  type Pallet,
  type ShipmentLine,
} from "@/lib/schemas";
import { generateSscc } from "@/lib/sscc";
import {
  findOutboundEdiTransaction,
  isApiConfigured,
  resendEdiTransaction,
  submitTransaction,
  type SubmitResult,
} from "@/lib/tediware";

export type ActionState = { status: "success" | "error"; message: string };

function fail(message: string): ActionState {
  return { status: "error", message };
}

function outcomeMessage(result: SubmitResult, noun: string): string {
  const reason = tediwareErrorMessage(result.responseBody);
  if (result.outcome === "rejected") {
    return reason
      ? `Tediware rejected the ${noun}: ${reason}`
      : `Tediware rejected the ${noun}. See the submission on the order.`;
  }
  return reason
    ? `Submitting the ${noun} failed: ${reason}`
    : `Submitting the ${noun} failed. See the submission on the order.`;
}

/**
 * Distributes shipped quantities into cartons and optionally assigns the
 * cartons to pallets. Each line's quantity is split across cartons as evenly
 * as whole units allow; a fractional quantity is not split and goes into the
 * first carton. Cartons reference pallets round-robin via palletSscc. SSCC
 * labels are generated for every carton and pallet.
 */
function packShipment(
  lines: ShipmentLine[],
  cartonCount: number,
  palletCount: number,
): { pallets?: Pallet[]; cartons: Carton[] } {
  const contents: CartonContent[][] = Array.from(
    { length: cartonCount },
    () => [],
  );
  for (const line of lines) {
    if (!Number.isInteger(line.quantityShipped)) {
      contents[0].push({
        lineNumber: line.lineNumber,
        quantity: line.quantityShipped,
      });
      continue;
    }
    const base = Math.floor(line.quantityShipped / cartonCount);
    const extra = line.quantityShipped % cartonCount;
    contents.forEach((carton, i) => {
      const qty = base + (i < extra ? 1 : 0);
      if (qty > 0) carton.push({ lineNumber: line.lineNumber, quantity: qty });
    });
  }

  const serial = Date.now();
  const filled = contents.filter((c) => c.length > 0);
  const pallets: Pallet[] = Array.from(
    { length: Math.min(palletCount, filled.length) },
    (_, i) => ({ sscc: generateSscc(serial + filled.length + i) }),
  );
  const cartons: Carton[] = filled.map((c, i) => ({
    sscc: generateSscc(serial + i),
    palletSscc:
      pallets.length > 0 ? pallets[i % pallets.length].sscc : undefined,
    contents: c,
  }));

  return { pallets: pallets.length > 0 ? pallets : undefined, cartons };
}

/** Per-line ship quantities from the form. A blank input means "not specified"
 * (the caller falls back to the ordered quantity), not zero. */
function readQuantities(formData: FormData): Map<number, number> {
  const map = new Map<number, number>();
  for (const [key, value] of formData.entries()) {
    const match = key.match(/^qty_(\d+)$/);
    if (!match || String(value).trim() === "") continue;
    const qty = Number(value);
    if (Number.isFinite(qty)) map.set(Number(match[1]), qty);
  }
  return map;
}

export async function shipOrder(
  orderId: number,
  formData: FormData,
): Promise<ActionState> {
  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .get();
  if (!order) return fail("Order not found.");
  if (order.status !== "received") {
    return fail(`Order is ${order.status}; it can only be shipped once.`);
  }

  const lines = db
    .select()
    .from(schema.orderLines)
    .where(eq(schema.orderLines.orderId, orderId))
    .orderBy(schema.orderLines.lineNumber)
    .all();

  const carrier = String(formData.get("carrier") ?? "").trim();
  const scac = String(formData.get("scac") ?? "").trim();
  const trackingNumber = String(formData.get("trackingNumber") ?? "").trim();
  const billOfLadingNumber = String(
    formData.get("billOfLadingNumber") ?? "",
  ).trim();
  const shipDate = String(formData.get("shipDate") ?? "").trim();
  const estimatedDeliveryDate = String(
    formData.get("estimatedDeliveryDate") ?? "",
  ).trim();
  const weightRaw = String(formData.get("totalWeight") ?? "").trim();
  const totalWeight = weightRaw === "" ? undefined : Number(weightRaw);
  const cartonCountRaw = Number(formData.get("cartonCount") ?? 1);
  const palletCountRaw = Number(formData.get("palletCount") ?? 0);
  const quantities = readQuantities(formData);

  for (const l of lines) {
    const qty = quantities.get(l.lineNumber);
    if (qty !== undefined && qty > l.quantityOrdered) {
      return fail(
        `Line ${l.lineNumber} (${l.sku}): cannot ship ${qty}; only ${l.quantityOrdered} ordered.`,
      );
    }
  }

  const shippedLines = lines
    .map((l) => ({
      lineNumber: l.lineNumber,
      sku: l.sku,
      buyerItemNumber: l.buyerItemNumber ?? undefined,
      description: l.description,
      quantityShipped: quantities.get(l.lineNumber) ?? l.quantityOrdered,
      unitOfMeasure: l.unitOfMeasure,
    }))
    .filter((l) => l.quantityShipped > 0);

  if (shippedLines.length === 0) {
    return fail("At least one line must ship a positive quantity.");
  }

  const cartonCount =
    Number.isInteger(cartonCountRaw) && cartonCountRaw > 0 ? cartonCountRaw : 1;
  const palletCount =
    Number.isInteger(palletCountRaw) && palletCountRaw > 0
      ? Math.min(palletCountRaw, cartonCount)
      : 0;
  const { pallets, cartons } = packShipment(
    shippedLines,
    cartonCount,
    palletCount,
  );

  const parsed = canonicalShipmentSchema.safeParse({
    poNumber: order.poNumber,
    // Numeric-only and at most 10 characters: the most restrictive partner
    // constraint on a shipment identifier seen so far, and safe everywhere.
    shipmentNumber: String(Math.floor(Date.now() / 1000)),
    shipDate,
    estimatedDeliveryDate: estimatedDeliveryDate || undefined,
    carrier,
    scac: scac || undefined,
    trackingNumber: trackingNumber || undefined,
    billOfLadingNumber: billOfLadingNumber || undefined,
    totalWeight,
    weightUnit: totalWeight === undefined ? undefined : "LB",
    shipTo: orderShipTo(order),
    lineItems: shippedLines,
    pallets,
    cartons,
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const shipment: CanonicalShipment = parsed.data;

  const result = await submitTransaction("856", shipment, order.partner);

  // The submission is always recorded. The order only advances if it is still
  // in `received` state: the earlier status check ran before the await, so a
  // concurrent double-submit could otherwise ship the order twice.
  const advanced = db.transaction((tx) => {
    const [submission] = tx
      .insert(schema.outboundSubmissions)
      .values({
        orderId,
        tsCode: "856",
        requestPayload: JSON.stringify(shipment, null, 2),
        responseStatus: result.responseStatus,
        responseBody: result.responseBody,
        outcome: result.outcome,
        traceGuid: result.traceGuid,
      })
      .returning({ id: schema.outboundSubmissions.id })
      .all();

    if (result.outcome !== "accepted") return false; // do not advance on rejection/error

    const updated = tx
      .update(schema.orders)
      .set({ status: "shipped" })
      .where(
        and(eq(schema.orders.id, orderId), eq(schema.orders.status, "received")),
      )
      .run();
    if (updated.changes === 0) return false; // lost a race; do not double-ship

    tx.insert(schema.shipments)
      .values({
        orderId,
        shipmentNumber: shipment.shipmentNumber,
        shippedAt: shipment.shipDate,
        carrier: shipment.carrier,
        trackingNumber: shipment.trackingNumber ?? null,
        submissionId: submission.id,
      })
      .run();

    return true;
  });

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/");
  revalidatePath("/activity");

  if (result.outcome !== "accepted") return fail(outcomeMessage(result, "shipment"));
  if (!advanced) {
    return fail(
      "Order was already shipped by another submission; this one was recorded but not applied.",
    );
  }
  return { status: "success", message: "Shipment submitted." };
}

export async function invoiceOrder(
  orderId: number,
  formData: FormData,
): Promise<ActionState> {
  const order = db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId))
    .get();
  if (!order) return fail("Order not found.");
  if (order.status !== "shipped") {
    return fail(`Order is ${order.status}; only a shipped order can be invoiced.`);
  }

  const lines = db
    .select()
    .from(schema.orderLines)
    .where(eq(schema.orderLines.orderId, orderId))
    .orderBy(schema.orderLines.lineNumber)
    .all();
  const shipment = db
    .select()
    .from(schema.shipments)
    .where(eq(schema.shipments.orderId, orderId))
    .get();

  const invoiceNumber = String(formData.get("invoiceNumber") ?? "").trim();
  const invoiceDate = String(formData.get("invoiceDate") ?? "").trim();
  const termsRaw = String(formData.get("paymentTermsDays") ?? "").trim();
  const paymentTermsDays = termsRaw === "" ? undefined : Number(termsRaw);

  if (invoiceNumber) {
    const duplicate = db
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(eq(schema.invoices.invoiceNumber, invoiceNumber))
      .get();
    if (duplicate) {
      return fail(`Invoice number ${invoiceNumber} is already used.`);
    }
  }

  // Bill what shipped, recovered from the shipment's submitted payload.
  const shipmentSubmission = shipment?.submissionId
    ? db
        .select()
        .from(schema.outboundSubmissions)
        .where(eq(schema.outboundSubmissions.id, shipment.submissionId))
        .get()
    : undefined;
  const invoiceLines = buildInvoiceLines(
    lines,
    parseShipmentPayload(shipmentSubmission?.requestPayload),
  );
  const subtotal = round2(invoiceLines.reduce((s, l) => s + l.lineTotal, 0));

  const parsed = canonicalInvoiceSchema.safeParse({
    poNumber: order.poNumber,
    orderDate: order.orderDate,
    vendorNumber: order.vendorNumber ?? undefined,
    invoiceNumber,
    invoiceDate,
    shipTo: orderShipTo(order),
    shipmentNumber: shipment?.shipmentNumber,
    currency: order.currency,
    paymentTermsDays,
    lineItems: invoiceLines,
    subtotal,
    total: subtotal,
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const invoice: CanonicalInvoice = parsed.data;

  const result = await submitTransaction("810", invoice, order.partner);

  // Same shape as shipOrder: record the submission unconditionally, advance the
  // order only if it is still `shipped` when the transaction runs.
  const advanced = db.transaction((tx) => {
    const [submission] = tx
      .insert(schema.outboundSubmissions)
      .values({
        orderId,
        tsCode: "810",
        requestPayload: JSON.stringify(invoice, null, 2),
        responseStatus: result.responseStatus,
        responseBody: result.responseBody,
        outcome: result.outcome,
        traceGuid: result.traceGuid,
      })
      .returning({ id: schema.outboundSubmissions.id })
      .all();

    if (result.outcome !== "accepted") return false;

    const updated = tx
      .update(schema.orders)
      .set({ status: "invoiced" })
      .where(
        and(eq(schema.orders.id, orderId), eq(schema.orders.status, "shipped")),
      )
      .run();
    if (updated.changes === 0) return false;

    tx.insert(schema.invoices)
      .values({
        orderId,
        invoiceNumber: invoice.invoiceNumber,
        invoicedAt: invoice.invoiceDate,
        total: invoice.total,
        submissionId: submission.id,
      })
      .run();

    return true;
  });

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/");
  revalidatePath("/activity");

  if (result.outcome !== "accepted") return fail(outcomeMessage(result, "invoice"));
  if (!advanced) {
    return fail(
      "Order was already invoiced by another submission; this one was recorded but not applied.",
    );
  }
  return { status: "success", message: "Invoice submitted." };
}

/**
 * Redelivers a past outbound submission (856 or 810) unchanged, for when the
 * first delivery did not reach the partner. Looks up the edi_transaction
 * Tediware recorded for the submission's traceGuid, then resends that. Does
 * not touch order state or write a new outbound_submissions row: Tediware
 * itself creates no new transaction record for a resend, so there is nothing
 * new to audit beyond what this action reports back to the user.
 */
export async function resendSubmission(submissionId: number): Promise<ActionState> {
  const submission = db
    .select()
    .from(schema.outboundSubmissions)
    .where(eq(schema.outboundSubmissions.id, submissionId))
    .get();
  if (!submission) return fail("Submission not found.");
  if (submission.outcome !== "accepted") {
    return fail("Only an accepted submission was actually sent; only that can be resent.");
  }
  if (!submission.traceGuid) {
    return fail(
      "This submission has no trace GUID; it was a stubbed local submission and was never sent to Tediware.",
    );
  }
  if (!isApiConfigured()) {
    return fail(
      "Tediware is not configured; set TEDIWARE_BASE_URL and TEDIWARE_API_KEY to resend.",
    );
  }

  try {
    const transaction = await findOutboundEdiTransaction(
      submission.traceGuid,
      submission.tsCode,
    );
    if (!transaction) {
      return fail("No EDI transaction found on Tediware for this submission's trace.");
    }

    const result = await resendEdiTransaction(transaction.id);
    if (result.outcome === "started") {
      return {
        status: "success",
        message: "Resend started. This does not confirm delivery; watch the trace.",
      };
    }
    if (result.outcome === "rejected") {
      return fail(`Tediware declined the resend: ${result.message}`);
    }
    return fail(`Resend failed: ${result.message}`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return fail(`Resend failed: ${message}`);
  }
}

function firstIssue(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid input.";
  const pathText = issue.path.map(String).join(".");
  return pathText ? `${pathText}: ${issue.message}` : issue.message;
}
