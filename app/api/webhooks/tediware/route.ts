import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";

import { db, schema } from "@/db";
import { ingestOrder } from "@/lib/ingest";
import { canonicalOrderSchema } from "@/lib/schemas";
import {
  fetchInboundDocument,
  readWebhook,
  resolveOrderPayload,
} from "@/lib/tediware";

/**
 * Inbound webhook: Tediware notifies us that a document is ready. We verify the
 * signature against the raw body, record the delivery idempotently, then fetch
 * the document and create the order.
 *
 * Idempotency: received_documents has a unique result_extid. A replay of an
 * already-processed delivery is acknowledged (200) without re-creating the
 * order. A replay of a failed/incomplete one is reprocessed, so a transient
 * fetch error can still succeed on Tediware's retry.
 */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const delivery = await readWebhook(request, "inbound");
  if (!delivery.ok) return json(delivery.status, { error: delivery.error });
  const { rawBody, resultExtid, traceGuid, requestId } = delivery;

  // Record the delivery. onConflictDoNothing makes the insert idempotent on
  // result_extid; if nothing came back, a row already exists.
  const [inserted] = db
    .insert(schema.receivedDocuments)
    .values({
      resultExtid,
      traceGuid,
      requestId,
      rawWebhookBody: rawBody,
      status: "received",
    })
    .onConflictDoNothing({ target: schema.receivedDocuments.resultExtid })
    .returning({ id: schema.receivedDocuments.id })
    .all();

  let documentId: number;
  if (inserted) {
    documentId = inserted.id;
  } else {
    const existing = db
      .select()
      .from(schema.receivedDocuments)
      .where(eq(schema.receivedDocuments.resultExtid, resultExtid))
      .get();
    if (!existing) return json(500, { error: "delivery_record_lost" });
    if (existing.status === "processed") {
      return json(200, { status: "duplicate", orderId: existing.orderId });
    }
    documentId = existing.id; // retry a previously failed/incomplete delivery
  }

  try {
    const { result, document } = await fetchInboundDocument(resultExtid);
    const canonical = canonicalOrderSchema.parse(
      resolveOrderPayload(document, result?.detail?.partner?.key),
    );
    const { orderId } = ingestOrder(canonical);

    db.update(schema.receivedDocuments)
      .set({
        status: "processed",
        rawFetchedPayload: JSON.stringify(document, null, 2),
        orderId,
        error: null,
      })
      .where(eq(schema.receivedDocuments.id, documentId))
      .run();

    revalidatePath("/");
    revalidatePath("/activity");
    revalidatePath(`/orders/${orderId}`);
    return json(200, { status: "processed", orderId });
  } catch (error) {
    const message = (error as Error).message;
    console.error(
      `[webhook] processing failed for result ${resultExtid}:`,
      message,
    );
    db.update(schema.receivedDocuments)
      .set({ status: "failed", error: message })
      .where(eq(schema.receivedDocuments.id, documentId))
      .run();
    // 500 so Tediware retries; the row is not 'processed', so the retry reprocesses.
    return json(500, { status: "failed", error: message });
  }
}
