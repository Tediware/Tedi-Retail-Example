import { handleDeliveryNotification } from "../delivery-notification";

/** Outbound webhook: Tediware delivered an 856 or 810 to the partner. */
export async function POST(request: Request): Promise<Response> {
  return handleDeliveryNotification(request, "outbound");
}
