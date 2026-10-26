import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DeliveryBadge, DeliveryFailure } from "@/components/delivery-status";
import { OutcomeBadge, StatusBadge } from "@/components/status-badge";
import { JsonViewer } from "@/components/json-viewer";
import type { OutboundSubmission } from "@/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  prettyJson,
} from "@/lib/format";
import {
  buildInvoiceLines,
  orderToCanonical,
  parseShipmentPayload,
} from "@/lib/mappers";
import { getOrderDetail, type Delivery } from "@/lib/queries";
import { round2 } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { InvoiceForm } from "./invoice-form";
import { ResendButton } from "./resend-button";
import { ShipForm } from "./ship-form";

const timeline = [
  {
    key: "received",
    label: "Received",
    blurb: "Order arrived from the retailer",
  },
  { key: "shipped", label: "Shipped", blurb: "Advance ship notice (856) sent" },
  { key: "invoiced", label: "Invoiced", blurb: "Invoice (810) sent" },
] as const;

const rank: Record<string, number> = { received: 0, shipped: 1, invoiced: 2 };

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) notFound();

  const detail = getOrderDetail(orderId);
  if (!detail) notFound();

  const {
    order,
    lines,
    shipment,
    invoice,
    submissions,
    deliveries,
    receivedDocument,
  } = detail;
  const canonicalOrder = orderToCanonical(order, lines);
  const shipmentSubmission = submissions.find((s) => s.tsCode === "856");
  const invoiceSubmission = submissions.find((s) => s.tsCode === "810");
  const current = rank[order.status] ?? 0;
  const failures = [
    { label: "Shipment (856)", submission: shipmentSubmission },
    { label: "Invoice (810)", submission: invoiceSubmission },
  ].flatMap(({ label, submission }) => {
    const delivery = submission ? deliveries[submission.id] : undefined;
    return delivery?.status === "failed" && delivery.notification
      ? [{ label, notification: delivery.notification }]
      : [];
  });

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          All orders
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {order.poNumber}
            </h1>
            <StatusBadge status={order.status} />
          </div>
          <p className="text-sm text-muted-foreground capitalize">
            {order.partner}
          </p>
        </div>
        <div className="flex gap-2">
          {order.status === "received" && (
            <ShipForm
              orderId={order.id}
              poNumber={order.poNumber}
              lines={lines.map((l) => ({
                lineNumber: l.lineNumber,
                sku: l.sku,
                description: l.description,
                quantityOrdered: l.quantityOrdered,
                unitOfMeasure: l.unitOfMeasure,
              }))}
            />
          )}
          {order.status === "shipped" && (
            <InvoiceForm
              orderId={order.id}
              poNumber={order.poNumber}
              currency={order.currency}
              total={round2(
                buildInvoiceLines(
                  lines,
                  parseShipmentPayload(
                    submissions.find((s) => s.id === shipment?.submissionId)
                      ?.requestPayload,
                  ),
                ).reduce((s, l) => s + l.lineTotal, 0),
              )}
            />
          )}
        </div>
      </div>

      {failures.map(({ label, notification }) => (
        <div key={label} className="space-y-1.5">
          <div className="text-sm font-medium">
            {label} was accepted but not delivered to {order.partner}
          </div>
          <DeliveryFailure notification={notification} />
        </div>
      ))}

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Order
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
            <Field label="Order date" value={formatDate(order.orderDate)} />
            <Field
              label="Requested ship"
              value={formatDate(order.requestedShipDate)}
            />
            <Field label="Currency" value={order.currency} />
            <Field label="Vendor number" value={order.vendorNumber ?? "-"} />
            <Field
              label="Total"
              value={formatMoney(order.orderTotal, order.currency)}
            />
            <div className="col-span-2 sm:col-span-3">
              <div className="mb-1.5 text-xs text-muted-foreground">
                Ship to
              </div>
              <address className="leading-relaxed not-italic">
                {order.shipToName}
                <br />
                {order.shipToAddress1}
                {order.shipToAddress2 ? (
                  <>
                    <br />
                    {order.shipToAddress2}
                  </>
                ) : null}
                <br />
                {order.shipToCity}, {order.shipToState} {order.shipToPostalCode}
                <br />
                {order.shipToCountry}
              </address>
              {order.shipToLocationId ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  Location {order.shipToLocationId}
                </div>
              ) : null}
            </div>
            {order.notes ? (
              <div className="col-span-2 sm:col-span-3">
                <div className="mb-1.5 text-xs text-muted-foreground">
                  Notes
                </div>
                <p className="leading-relaxed">{order.notes}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4">
              {timeline.map((step, i) => {
                const done = i <= current;
                return (
                  <li key={step.key} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={cn(
                          "mt-0.5 size-2.5 rounded-full ring-2 ring-offset-2 ring-offset-background",
                          done
                            ? "bg-foreground ring-foreground"
                            : "bg-transparent ring-border",
                        )}
                      />
                      {i < timeline.length - 1 && (
                        <span
                          className={cn(
                            "mt-1 h-8 w-px",
                            i < current ? "bg-foreground" : "bg-border",
                          )}
                        />
                      )}
                    </div>
                    <div className={cn(!done && "text-muted-foreground")}>
                      <div className="text-sm font-medium">{step.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {step.blurb}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Line items</h2>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Line total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="text-muted-foreground">
                    {line.lineNumber}
                  </TableCell>
                  <TableCell className="font-medium">
                    {line.sku}
                    {line.buyerItemNumber ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        buyer {line.buyerItemNumber}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{line.description}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {line.quantityOrdered} {line.unitOfMeasure}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(line.unitPrice, order.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(
                      line.quantityOrdered * line.unitPrice,
                      order.currency,
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Documents</h2>
        <p className="text-sm text-muted-foreground">
          The canonical JSON received or sent for this order. This is exactly
          what crossed the wire with Tediware.
        </p>
        <Tabs defaultValue="order">
          <TabsList>
            <TabsTrigger value="order">Order</TabsTrigger>
            <TabsTrigger value="shipment" disabled={!shipmentSubmission}>
              Shipment (856)
            </TabsTrigger>
            <TabsTrigger value="invoice" disabled={!invoiceSubmission}>
              Invoice (810)
            </TabsTrigger>
          </TabsList>
          <TabsContent value="order" className="pt-3">
            <JsonViewer
              value={
                receivedDocument?.rawFetchedPayload ??
                prettyJson(canonicalOrder)
              }
            />
            {!receivedDocument && (
              <p className="mt-2 text-xs text-muted-foreground">
                Reconstructed from stored fields; this order was not received
                through a live webhook.
              </p>
            )}
          </TabsContent>
          <TabsContent value="shipment" className="pt-3">
            {shipmentSubmission ? (
              <SubmissionView
                submission={shipmentSubmission}
                delivery={deliveries[shipmentSubmission.id]}
              />
            ) : null}
          </TabsContent>
          <TabsContent value="invoice" className="pt-3">
            {invoiceSubmission ? (
              <SubmissionView
                submission={invoiceSubmission}
                delivery={deliveries[invoiceSubmission.id]}
              />
            ) : null}
          </TabsContent>
        </Tabs>
      </section>

      {(shipment || invoice) && (
        <section className="space-y-3">
          <Separator />
          <div className="grid gap-6 text-sm sm:grid-cols-2">
            {shipment && (
              <div className="space-y-1">
                <div className="font-medium">Shipment</div>
                <Field label="Number" value={shipment.shipmentNumber} />
                <Field label="Carrier" value={shipment.carrier} />
                <Field
                  label="Tracking"
                  value={shipment.trackingNumber ?? "-"}
                />
                <Field label="Shipped" value={formatDate(shipment.shippedAt)} />
              </div>
            )}
            {invoice && (
              <div className="space-y-1">
                <div className="font-medium">Invoice</div>
                <Field label="Number" value={invoice.invoiceNumber} />
                <Field
                  label="Total"
                  value={formatMoney(invoice.total, order.currency)}
                />
                <Field
                  label="Invoiced"
                  value={formatDate(invoice.invoicedAt)}
                />
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** The most recent submission of a document: its outcome, payload, and what
 * Tediware answered. Earlier attempts stay on the activity log. */
function SubmissionView({
  submission,
  delivery,
}: {
  submission: OutboundSubmission;
  delivery?: Delivery;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <OutcomeBadge outcome={submission.outcome} />
        {delivery && <DeliveryBadge status={delivery.status} />}
        <span className="tabular-nums">
          HTTP {submission.responseStatus ?? "-"}
        </span>
        <span>{formatDateTime(submission.submittedAt)}</span>
        {submission.outcome === "accepted" && (
          <ResendButton submissionId={submission.id} />
        )}
      </div>
      <div>
        <div className="mb-1.5 text-xs text-muted-foreground">
          Request payload
        </div>
        <JsonViewer value={submission.requestPayload} />
      </div>
      {submission.responseBody ? (
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">
            Tediware response
          </div>
          <JsonViewer value={prettyJson(submission.responseBody)} />
        </div>
      ) : null}
      {delivery?.notification ? (
        <div>
          <div className="mb-1.5 text-xs text-muted-foreground">
            {delivery.status === "failed"
              ? "Tediware result for the failed step"
              : "Tediware result for the delivery"}
          </div>
          <JsonViewer
            value={
              delivery.notification.rawResult ??
              prettyJson(delivery.notification.rawWebhookBody)
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:block">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tabular-nums">{value}</div>
    </div>
  );
}
