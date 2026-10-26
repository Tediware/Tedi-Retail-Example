import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/db";
import { fetchResult, isApiConfigured, readWebhook } from "@/lib/tediware";

/**
 * Delivery notifications for outbound documents. Submitting an 856 or 810
 * only queues it; Tediware reports the real outcome later, on the partner's
 * outbound webhook when the document was delivered and on its error webhook
 * when a step failed. Both send the same body, so each role has its own route
 * and the route is what says delivered or failed.
 *
 * The notification carries a result id and trace GUID. The trace GUID joins
 * it to the outbound_submissions row that started the trace; the result is
 * fetched for its error message and individual validation errors.
 *
 * Idempotency mirrors the inbound route: delivery_notifications has a unique
 * result_extid. A replay is acknowledged without refetching once the result
 * was fetched; a replay of one whose fetch failed tries the fetch again.
 */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleDeliveryNotification(
  request: Request,
  role: "outbound" | "error",
): Promise<Response> {
  const delivery = await readWebhook(request, role);
  if (!delivery.ok) return json(delivery.status, { error: delivery.error });
  const { rawBody, resultExtid, traceGuid, requestId } = delivery;

  const [inserted] = db
    .insert(schema.deliveryNotifications)
    .values({
      role,
      resultExtid,
      traceGuid,
      requestId,
      rawWebhookBody: rawBody,
    })
    .onConflictDoNothing({ target: schema.deliveryNotifications.resultExtid })
    .returning({ id: schema.deliveryNotifications.id })
    .all();

  let notificationId: number;
  if (inserted) {
    notificationId = inserted.id;
  } else {
    const existing = db
      .select()
      .from(schema.deliveryNotifications)
      .where(eq(schema.deliveryNotifications.resultExtid, resultExtid))
      .get();
    if (!existing) return json(500, { error: "delivery_record_lost" });
    if (existing.rawResult !== null || !isApiConfigured()) {
      return json(200, { status: "duplicate" });
    }
    notificationId = existing.id; // retry a fetch that failed earlier
  }

  // Without API config the role alone is recorded: delivered or failed, with
  // no detail to show.
  let fetchError: string | null = null;
  if (isApiConfigured()) {
    try {
      const result = await fetchResult(resultExtid);
      const errors = result.detail?.errors ?? [];
      db.update(schema.deliveryNotifications)
        .set({
          rawResult: JSON.stringify(result, null, 2),
          errorMessage: result.detail?.errorMessage ?? null,
          errors: errors.length > 0 ? JSON.stringify(errors) : null,
          fetchError: null,
        })
        .where(eq(schema.deliveryNotifications.id, notificationId))
        .run();
    } catch (error) {
      fetchError = (error as Error).message;
      console.error(
        `[webhook:${role}] fetching result ${resultExtid} failed:`,
        fetchError,
      );
      db.update(schema.deliveryNotifications)
        .set({ fetchError })
        .where(eq(schema.deliveryNotifications.id, notificationId))
        .run();
    }
  }

  const submission = traceGuid
    ? db
        .select({ orderId: schema.outboundSubmissions.orderId })
        .from(schema.outboundSubmissions)
        .where(eq(schema.outboundSubmissions.traceGuid, traceGuid))
        .get()
    : undefined;
  if (submission?.orderId) revalidatePath(`/orders/${submission.orderId}`);
  revalidatePath("/");
  revalidatePath("/activity");

  // 500 so Tediware retries and the fetch gets another chance; the delivered
  // or failed outcome itself is already recorded.
  if (fetchError) return json(500, { status: "recorded", error: fetchError });
  return json(200, { status: "recorded" });
}
