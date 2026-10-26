import { handleDeliveryNotification } from "../delivery-notification";

/** Error webhook: a step in one of the partner's flows failed. */
export async function POST(request: Request): Promise<Response> {
  return handleDeliveryNotification(request, "error");
}
