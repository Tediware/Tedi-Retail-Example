import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listOrders } from "@/lib/queries";
import { formatDate, formatMoney } from "@/lib/format";

// Reads live DB state; never serve a build-time snapshot.
export const dynamic = "force-dynamic";

export default function InboxPage() {
  const orders = listOrders();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <p className="text-sm text-muted-foreground">
          Purchase orders received from retailers via Tediware.
        </p>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No orders yet. They appear here when Tediware delivers a purchase
          order.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO number</TableHead>
                <TableHead>Partner</TableHead>
                <TableHead>Order date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id} className="relative hover:bg-muted/50">
                  <TableCell className="font-medium">
                    <Link
                      href={`/orders/${order.id}`}
                      className="after:absolute after:inset-0"
                    >
                      {order.poNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="capitalize">{order.partner}</TableCell>
                  <TableCell>{formatDate(order.orderDate)}</TableCell>
                  <TableCell>
                    <StatusBadge status={order.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(order.orderTotal, order.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
