import { apiGetJson, apiRequest, TediwareError } from "./client";

/**
 * Resending an outbound document that never reached the partner (or that the
 * partner says they never received). Per the edi_transactions docs, a resend
 * re-uploads the originally stored bytes under the original control numbers;
 * Tediware creates no new transaction record, and the redelivery lands on the
 * original traceGuid, the same GUID `submitTransaction` returned when the
 * document was first sent. So resend is a two-step lookup from that GUID:
 * find the outbound edi_transaction it produced, then resend it by id.
 */

export type EdiTransaction = {
  id: string;
  incoming: boolean;
  transactionSetIdentifier: string;
  traceGuid: string;
};

export type ResendResult =
  | { outcome: "started"; ediTransactionId: string }
  // Documented, expected outcomes: bad key, not found, already-gone content,
  // rate limited, etc. (see the 401/403/404/422/429 table in the docs).
  | { outcome: "rejected"; message: string }
  | { outcome: "error"; message: string };

/**
 * The one outbound edi_transaction produced by a given submission, found by
 * the traceGuid `submitTransaction` returned. Null if Tediware has not
 * recorded one (yet, or ever) for this trace.
 */
export async function findOutboundEdiTransaction(
  traceGuid: string,
  transactionSetIdentifier: string,
): Promise<EdiTransaction | null> {
  const params = new URLSearchParams({
    trace: traceGuid,
    incoming: "false",
    transaction_set_identifier: transactionSetIdentifier,
  });
  const response = await apiGetJson<{ ediTransactions: EdiTransaction[] }>(
    `/platform/edi_transactions?${params.toString()}`,
  );
  return response.ediTransactions[0] ?? null;
}

/**
 * Redelivers a past outbound edi_transaction byte for byte. A 202 means the
 * resend started in the background, not that delivery is confirmed; watch
 * the transaction's trace for the outcome. A 422 with one of the documented
 * codes (not_outbound, content_unavailable, delivery_node_missing,
 * not_flow_delivered, delivery_target_missing), a 401/403 auth failure, a 404,
 * or a 429 (10 resends/minute/key, tighter than the general rate limit) are
 * normal, expected outcomes, so they are returned as "rejected" rather than
 * thrown; anything else is "error".
 */
export async function resendEdiTransaction(id: string): Promise<ResendResult> {
  try {
    const response = await apiRequest(
      `/platform/edi_transactions/${encodeURIComponent(id)}/resend`,
      { method: "POST" },
    );
    const text = await response.text();

    if (response.status === 202) {
      const body = JSON.parse(text) as { ediTransactionId?: unknown };
      return {
        outcome: "started",
        ediTransactionId:
          typeof body.ediTransactionId === "string" ? body.ediTransactionId : id,
      };
    }

    if ([401, 403, 404, 422, 429].includes(response.status)) {
      return { outcome: "rejected", message: readErrorMessage(text) ?? text };
    }

    return { outcome: "error", message: `HTTP ${response.status}: ${text}` };
  } catch (cause) {
    const message = cause instanceof TediwareError ? cause.message : String(cause);
    return { outcome: "error", message };
  }
}

function readErrorMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown; code?: unknown };
    };
    const message = parsed.error?.message ?? parsed.error?.code;
    return typeof message === "string" && message.trim() !== "" ? message : null;
  } catch {
    return null;
  }
}
