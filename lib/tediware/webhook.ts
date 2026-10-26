import { getSigningConfig, type WebhookRole } from "./env";
import { verifyWebhookSignature } from "./signature";

/**
 * Reading a webhook delivery: log it, verify the signature against the raw
 * body, parse the notification. Shared by every webhook route; what each route
 * does with the notification differs, receiving one does not.
 *
 * Every role sends the same small notification (the data is fetched
 * separately). Inbound shape is from the docs; outbound and error are assumed
 * to match.
 * CONFIRM: outbound and error notification body shape.
 */

export type WebhookNotification = {
  nodeId?: number | string;
  timestamp?: string;
  output?: { resultId?: number | string; traceGuid?: string };
  requestId?: string;
};

export type ReadWebhookResult =
  | {
      ok: true;
      rawBody: string;
      notification: WebhookNotification;
      resultExtid: string;
      traceGuid: string | null;
      requestId: string | null;
    }
  | { ok: false; status: number; error: string };

export async function readWebhook(
  request: Request,
  role: WebhookRole,
): Promise<ReadWebhookResult> {
  const tag = `[webhook:${role}]`;
  const rawBody = await request.text();

  // One line per attempt, so redeliveries of the same result can be told apart
  // and timed. t= is Tediware's signing time for this attempt.
  const signedAt = /t=(\d+)/.exec(
    request.headers.get("X-Webhook-Signature") ?? "",
  )?.[1];
  // Every other X- header too (the signature itself left out), so new
  // delivery headers show up without a code change.
  const extraHeaders = [...request.headers.entries()]
    .filter(
      ([name]) =>
        name.startsWith("x-") &&
        name !== "x-request-id" &&
        name !== "x-webhook-signature",
    )
    .map(([name, value]) => `${name}=${value}`)
    .join(" ");
  console.log(
    `${tag} attempt at=${new Date().toISOString()} x-request-id=${request.headers.get("X-Request-ID") ?? "-"} signed-t=${signedAt ?? "-"} ${extraHeaders}`.trimEnd(),
  );

  // Print every arriving delivery to the dev console, pretty-printed when the
  // body is JSON, verbatim when it is not.
  try {
    console.log(
      `${tag} delivery received:\n${JSON.stringify(JSON.parse(rawBody), null, 2)}`,
    );
  } catch {
    console.log(`${tag} delivery received (non-JSON body):\n${rawBody}`);
  }

  let signing;
  try {
    signing = getSigningConfig(role);
  } catch (error) {
    console.error(`${tag} cannot verify:`, (error as Error).message);
    return { ok: false, status: 500, error: "webhook secret not configured" };
  }

  const verdict = verifyWebhookSignature(
    rawBody,
    request.headers.get("X-Webhook-Signature"),
    signing,
  );
  if (!verdict.valid) {
    console.warn(`${tag} rejected: ${verdict.reason}`);
    return { ok: false, status: 401, error: verdict.reason };
  }

  let notification: WebhookNotification;
  try {
    notification = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }

  const resultId = notification.output?.resultId;
  if (resultId === undefined || resultId === null) {
    return { ok: false, status: 400, error: "missing_result_id" };
  }

  return {
    ok: true,
    rawBody,
    notification,
    resultExtid: String(resultId),
    traceGuid: notification.output?.traceGuid ?? null,
    requestId:
      notification.requestId ?? request.headers.get("X-Request-ID") ?? null,
  };
}
