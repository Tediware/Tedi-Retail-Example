import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type OrderStatus = "received" | "shipped" | "invoiced";

const dotColor: Record<OrderStatus, string> = {
  received: "bg-blue-500",
  shipped: "bg-amber-500",
  invoiced: "bg-emerald-500",
};

const label: Record<OrderStatus, string> = {
  received: "Received",
  shipped: "Shipped",
  invoiced: "Invoiced",
};

/** Order status shown as a labelled dot. */
export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className={cn("size-1.5 rounded-full", dotColor[status])} />
      {label[status]}
    </Badge>
  );
}

const outcomeVariant: Record<string, "default" | "destructive" | "outline"> = {
  accepted: "default",
  rejected: "destructive",
  error: "destructive",
};

/** Outcome of an outbound submission (accepted / rejected / error). */
export function OutcomeBadge({ outcome }: { outcome: string }) {
  return (
    <Badge variant={outcomeVariant[outcome] ?? "outline"}>
      {outcome[0]?.toUpperCase() + outcome.slice(1)}
    </Badge>
  );
}
