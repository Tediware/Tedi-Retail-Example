import { apiRequest, TediwareError } from "./client";
import { isTediwareConfigured } from "./env";

/**
 * Submitting outbound documents (856, 810) to Tediware, which maps them to the
 * partner's EDI and delivers them. Per the outbound-edi docs, the endpoint is
 * `POST /platform/partners/:key/ts/:code` with body `{ "contents": <payload> }`,
 * and a 200 means "Processing queued": translation and delivery happen
 * asynchronously, with the final outcome reported to the outbound or error
 * webhook. The returned traceGuid links this submission to those later results.
 *
 * A synchronous non-2xx (missing contents, unconfigured partner or transaction
 * set) is a normal, expected outcome, so it is reported distinctly from a
 * transport error rather than thrown. Submissions are not idempotent (each POST
 * consumes control numbers), so nothing here retries a timeout.
 */

export type TsCode = "856" | "810";

export type SubmitResult = {
  outcome: "accepted" | "rejected" | "error";
  responseStatus: number | null;
  responseBody: string;
  /** Links all of Tediware's processing results for this submission. */
  traceGuid: string | null;
  /** True when the submission was recorded without contacting Tediware. */
  stubbed: boolean;
};

export async function submitTransaction(
  tsCode: TsCode,
  payload: unknown,
  /** The trading partner this document goes to, as stored on the order. */
  partner: string,
): Promise<SubmitResult> {
  if (!isTediwareConfigured()) {
    return {
      outcome: "accepted",
      responseStatus: null,
      responseBody: JSON.stringify({
        note: "Submission stubbed; Tediware not configured. Set TEDIWARE_BASE_URL, TEDIWARE_API_KEY, TEDIWARE_PARTNER_KEY to send for real.",
      }),
      traceGuid: null,
      stubbed: true,
    };
  }

  // The endpoint paths use uppercase partner keys (PETCO, KROGER) while the
  // result detail's partner.key, which labels our orders, arrives lowercase.
  // Normalize to uppercase; unconfirmed whether the route is case-sensitive.
  // CONFIRM: exact partner key casing for URL paths.
  const path = `/platform/partners/${encodeURIComponent(partner.trim().toUpperCase())}/ts/${tsCode}`;

  try {
    const response = await apiRequest(path, {
      method: "POST",
      body: JSON.stringify({ contents: payload }),
    });
    const body = await response.text();

    if (response.ok) {
      return {
        outcome: "accepted",
        responseStatus: response.status,
        responseBody: body,
        traceGuid: readTraceGuid(body),
        stubbed: false,
      };
    }
    console.error(
      `Tediware ${tsCode} submission for ${partner} returned ${response.status}: ${body}`,
    );
    // Documented request failures: 400 missing_parameter/invalid_envelope,
    // 404 partner or transaction set not configured, 422 configuration_error.
    if ([400, 404, 422].includes(response.status)) {
      return {
        outcome: "rejected",
        responseStatus: response.status,
        responseBody: body,
        traceGuid: null,
        stubbed: false,
      };
    }
    return {
      outcome: "error",
      responseStatus: response.status,
      responseBody: body,
      traceGuid: null,
      stubbed: false,
    };
  } catch (cause) {
    const message =
      cause instanceof TediwareError ? cause.message : String(cause);
    console.error(
      `Tediware ${tsCode} submission for ${partner} failed: ${message}`,
    );
    return {
      outcome: "error",
      responseStatus: null,
      responseBody: JSON.stringify({ error: message }),
      traceGuid: null,
      stubbed: false,
    };
  }
}

function readTraceGuid(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { traceGuid?: unknown };
    return typeof parsed.traceGuid === "string" ? parsed.traceGuid : null;
  } catch {
    return null;
  }
}
