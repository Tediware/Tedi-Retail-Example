import Link from "next/link";

import { DeliveryBadge, failureSummary } from "@/components/delivery-status";
import { OutcomeBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, tediwareErrorMessage } from "@/lib/format";
import { getActivity } from "@/lib/queries";

// Reads live DB state; never serve a build-time snapshot.
export const dynamic = "force-dynamic";

export default function ActivityPage() {
  const { received, submissions, deliveries, unmatchedErrors } = getActivity();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Every inbound delivery, outbound submission and delivery outcome,
          newest first.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Outbound submissions</h2>
        {submissions.length === 0 ? (
          <Empty>No shipments or invoices have been submitted yet.</Empty>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>Response</TableHead>
                  <TableHead>Order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.map((s) => {
                  const delivery = deliveries[s.id];
                  const failure =
                    delivery?.status === "failed" && delivery.notification
                      ? failureSummary(delivery.notification)
                      : null;
                  const problem = failure
                    ? [failure.message, ...failure.errors].join(" ")
                    : s.outcome === "accepted"
                      ? null
                      : (tediwareErrorMessage(s.responseBody) ??
                        "See the submission on the order.");
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(s.submittedAt)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {s.tsCode === "856"
                          ? "Shipment (856)"
                          : "Invoice (810)"}
                      </TableCell>
                      <TableCell>
                        <OutcomeBadge outcome={s.outcome} />
                      </TableCell>
                      <TableCell>
                        {delivery ? (
                          <DeliveryBadge status={delivery.status} />
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {s.responseStatus ?? "-"}
                      </TableCell>
                      <TableCell className="max-w-md">
                        {problem ? (
                          <span
                            className="block truncate text-muted-foreground"
                            title={problem}
                          >
                            {problem}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {s.orderId ? (
                          <Link
                            href={`/orders/${s.orderId}`}
                            className="underline-offset-4 hover:underline"
                          >
                            View
                          </Link>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {unmatchedErrors.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">Other flow errors</h2>
          <p className="text-sm text-muted-foreground">
            Error notifications that match no submission from this app, such as
            an inbound document failing in Tediware.
          </p>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Trace</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unmatchedErrors.map((n) => {
                  const failure = failureSummary(n);
                  const text = [failure.message, ...failure.errors].join(" ");
                  return (
                    <TableRow key={n.id}>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(n.receivedAt)}
                      </TableCell>
                      <TableCell>{failure.node ?? "-"}</TableCell>
                      <TableCell className="max-w-md">
                        <span
                          className="block truncate text-muted-foreground"
                          title={text}
                        >
                          {text}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {n.traceGuid ?? "-"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Inbound deliveries</h2>
        {received.length === 0 ? (
          <Empty>
            No webhook deliveries recorded yet. They appear here when Tediware
            delivers a document.
          </Empty>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Received</TableHead>
                  <TableHead>Result id</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {received.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(d.receivedAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {d.resultExtid}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          d.status === "failed" ? "destructive" : "outline"
                        }
                      >
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {d.orderId ? (
                        <Link
                          href={`/orders/${d.orderId}`}
                          className="underline-offset-4 hover:underline"
                        >
                          View
                        </Link>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
