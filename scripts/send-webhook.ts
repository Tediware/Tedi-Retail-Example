import fs from "node:fs"
import path from "node:path"

import { canonicalOrderSchema } from "../lib/schemas"
import { signWebhookBody } from "../lib/tediware/signature"

/**
 * Dev-only harness: writes a result fixture, then signs and POSTs a webhook
 * notification to the running app, exercising the full inbound path (verify,
 * record, fetch, create order) without a live Tediware.
 *
 * Usage:
 *   npm run webhook:send            # result 900001, PO PET-900001
 *   npm run webhook:send -- 900002  # a different result id / PO
 *   npm run webhook:send -- <uuid>  # with a live Tediware configured: replay a
 *                                   # real result id (fetches live, no fixture)
 *
 * Re-running with the same id demonstrates replay idempotency (200 duplicate).
 * Requires TEDIWARE_WEBHOOK_SECRET set in .env.local (any value); the app must
 * be running with the same secret.
 */

try {
  process.loadEnvFile(path.join(process.cwd(), ".env.local"))
} catch {
  // .env.local is optional; the secret may come from the ambient environment.
}

const secret = process.env.TEDIWARE_WEBHOOK_SECRET?.trim()
if (!secret) {
  console.error(
    "TEDIWARE_WEBHOOK_SECRET is not set. Add it to .env.local (any value), " +
      "restart the app so it uses the same secret, then run this again."
  )
  process.exit(1)
}

const appUrl =
  process.env.APP_URL?.replace(/\/+$/, "") ?? "http://localhost:3007"
const resultId = process.argv[2] ?? "900001"
const poNumber = `PET-${resultId}`

// With a live Tediware configured the app fetches the result from the API, so
// only write the local fixture when the app would actually read it.
const liveFetch =
  !!process.env.TEDIWARE_BASE_URL?.trim() &&
  !!process.env.TEDIWARE_API_KEY?.trim()

if (!liveFetch) {
  // Sample canonical order standing in for the fetched document.
  const order = canonicalOrderSchema.parse({
    poNumber,
    partner: "petco",
    orderDate: "2026-07-06",
    requestedShipDate: "2026-07-16",
    currency: "USD",
    shipTo: {
      name: "Petco Distribution Center 21",
      address1: "3300 Fulfillment Rd",
      city: "Columbus",
      state: "OH",
      postalCode: "43219",
      country: "US",
    },
    lineItems: [
      {
        lineNumber: 1,
        sku: "LB-3300",
        buyerItemNumber: "PET-LB33",
        description: "Litter box, hooded, jumbo",
        quantityOrdered: 40,
        unitOfMeasure: "EA",
        unitPrice: 19.5,
      },
      {
        lineNumber: 2,
        sku: "TL-0090",
        buyerItemNumber: "PET-TL09",
        description: "Cat litter, clumping, 40 lb",
        quantityOrdered: 100,
        unitOfMeasure: "EA",
        unitPrice: 14.25,
      },
    ],
  })

  // Write the result fixture that the app's fetchInboundDocument() reads when
  // Tediware is not configured.
  const fixturesDir = path.join(process.cwd(), "fixtures", "results")
  fs.mkdirSync(fixturesDir, { recursive: true })
  fs.writeFileSync(
    path.join(fixturesDir, `${resultId}.json`),
    JSON.stringify(order, null, 2)
  )
}

const body = JSON.stringify({
  nodeId: 123,
  timestamp: new Date().toISOString(),
  output: { resultId, traceGuid: crypto.randomUUID() },
  requestId: crypto.randomUUID(),
})

const signature = signWebhookBody(body, secret)

const response = await fetch(`${appUrl}/api/webhooks/tediware`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Webhook-Signature": signature,
    "X-Request-ID": crypto.randomUUID(),
  },
  body,
})

const responseBody = await response.text()
console.log(`POST /api/webhooks/tediware -> ${response.status}`)
console.log(responseBody)

if (!response.ok && response.status !== 200) {
  process.exit(1)
}
