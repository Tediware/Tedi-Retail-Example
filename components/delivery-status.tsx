import { Badge } from "@/components/ui/badge";
import type { DeliveryNotification } from "@/db/schema";
import type { Delivery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const deliveryLabel: Record<Delivery["status"], string> = {
  pending: "Awaiting delivery",
  delivered: "Delivered",
  failed: "Not delivered",
};

/** Whether Tediware got an accepted document to the partner. */
export function DeliveryBadge({ status }: { status: Delivery["status"] }) {
  return (
    <Badge
      variant={status === "failed" ? "destructive" : "outline"}
      className="gap-1.5"
    >
      {status !== "failed" && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            status === "delivered" ? "bg-emerald-500" : "bg-muted-foreground",
          )}
        />
      )}
      {deliveryLabel[status]}
    </Badge>
  );
}

export type FailureSummary = {
  /** The flow step that failed, e.g. "PETCO 856 Validation + EDI Write". */
  node: string | null;
  message: string;
  errors: string[];
};

/**
 * The readable parts of an error notification. When the result lists its
 * validation errors, the message's own copy of them (and the implementation
 * id) is trimmed so each error shows once.
 */
export function failureSummary(n: DeliveryNotification): FailureSummary {
  let node: string | null = null;
  if (n.rawResult) {
    try {
      node =
        (JSON.parse(n.rawResult) as { nodeName?: string }).nodeName ?? null;
    } catch {
      node = null;
    }
  }
  let errors: string[] = [];
  if (n.errors) {
    try {
      errors = JSON.parse(n.errors) as string[];
    } catch {
      errors = [];
    }
  }
  let message =
    n.errorMessage ??
    (n.fetchError
      ? `Tediware reported a failure; its details could not be fetched (${n.fetchError}).`
      : "Tediware reported a failure without a message.");
  if (errors.length > 0) {
    message = message
      .replace(/\s*\([0-9a-f-]{36}\)/i, "")
      .replace(/:\s*\d+ errors?:[\s\S]*$/, ".");
  }
  return { node, message, errors };
}

/** Why an accepted document did not reach the partner. */
export function DeliveryFailure({
  notification,
  className,
}: {
  notification: DeliveryNotification;
  className?: string;
}) {
  const { node, message, errors } = failureSummary(notification);
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm",
        className,
      )}
    >
      <div className="font-medium text-destructive">
        {node ? `Failed at ${node}` : "Delivery failed"}
      </div>
      <p className="leading-relaxed">{message}</p>
      {errors.length > 0 && (
        <ul className="space-y-1 font-mono text-xs">
          {errors.map((e) => (
            <li key={e} className="break-all">
              {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
