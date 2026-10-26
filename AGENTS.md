# AGENTS.md

This file provides guidance to coding agents working with code in this repository.

## What this app is

A small Next.js app that plays the role of a Tediware customer: a retail supplier receiving purchase orders from a retailer (Petco) and sending back shipments and invoices. It exists to exercise Tediware's APIs and webhooks from an integrating developer's seat. The document loop is: 850 purchase order in (webhook) -> user ships (POST canonical 856) -> user invoices (POST canonical 810).

The app never sees, parses, or produces raw EDI; Tediware handles all EDI translation. Outbound, the app POSTs its own canonical JSON and Tediware-side mappings render the EDI. Inbound, Tediware's mapping targets an 850 *implementation* (a spec), so the delivered document is X12-shaped JSON that is stable across partners and releases; `lib/tediware/inbound-order.ts` does the final-mile translation into the canonical order. The Tediware HTTP API and docs are the only contract.

See `README.md` for setup and `SCHEMAS.md` for canonical shapes.

## Commands

```bash
npm run dev            # dev server at http://localhost:3007
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run format         # prettier over ts/tsx
npm run build          # production build
npm run db:migrate     # apply migrations (creates data/tedi.db)
npm run db:seed        # seed fake Petco orders
npm run db:reset       # rm data/tedi.db + migrate + seed (normal reset path)
npm run webhook:send   # sign and POST a fixture webhook locally (needs TEDIWARE_WEBHOOK_SECRET set and dev server running); pass an id: npm run webhook:send -- 900002
npm run db:generate    # drizzle-kit generate (after editing db/schema.ts)
```

There is no test suite. Verification is typecheck + lint + exercising the flow (seeded orders, `webhook:send`, ship/invoice in the UI).

Requires Node 20.18+ (`.nvmrc` pins the version; `nvm use`).

## Next.js version warning

This project uses a Next.js version with breaking changes relative to most training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js-specific code.

## Architecture

### The canonical shape principle (most important design rule)

The zod schemas in `lib/schemas/` (order, shipment, invoice) are this app's public API and are designed as a naive supplier would design them: natural field names, no EDI vocabulary (no segment names, qualifier codes), no Petco-specific fields. The binding acceptance test: adding a second retailer must require **zero code changes** in this repo, only Tediware-side mapping config. Any schema decision that breaks this is wrong. The one piece of this repo that speaks X12 vocabulary is `lib/tediware/inbound-order.ts`, and it must stay qualifier-generic (select by position and code, never by partner-specific values) so the acceptance test holds.

### lib/tediware/: the only code that touches Tediware

Route handlers and server actions call it; nothing else fetches Tediware URLs. It is the rough draft of a future SDK, so keep the surface small and plain (no retry frameworks, no queues):

- `env.ts`: config is validated **per capability**, not all-or-nothing. The app runs fully local with nothing configured: signature verification needs only `TEDIWARE_WEBHOOK_SECRET`; result fetch needs `TEDIWARE_BASE_URL` + `TEDIWARE_API_KEY`; outbound submission also needs `TEDIWARE_PARTNER_KEY`. Each getter throws listing exactly what is missing.
- `webhook.ts`: `readWebhook(request, role)` logs the attempt, verifies the signature with that role's secret, and parses the notification. Every webhook route starts here. Outbound and error roles read `TEDIWARE_OUTBOUND_WEBHOOK_SECRET` / `TEDIWARE_ERROR_WEBHOOK_SECRET`, falling back to `TEDIWARE_WEBHOOK_SECRET`.
- `signature.ts`: HMAC-SHA256 over `"{timestamp}.{rawBody}"` from the `X-Webhook-Signature: t=...,v1=...` header, constant-time compare, timestamp tolerance window.
- `results.ts`: fetches a document after webhook notification: `GET /platform/results/:id` for metadata, then downloads the `usage: "output"` JSON artifact via `GET /platform/artifacts/:id`. When unconfigured, reads `fixtures/results/<id>.json` instead, so the whole inbound path runs locally.
- `inbound-order.ts`: translates the delivered X12-shaped 850 JSON into the canonical order (`resolveOrderPayload`); canonical-shaped fixtures pass through untouched. Looks segments/elements up by stable suffix (`_BEG`, `_03`) and selects parties/ids by qualifier code.
- `submit.ts`: POSTs 856/810. When unconfigured, returns a stubbed `accepted`. A validation rejection is a normal outcome returned as `{outcome: "rejected"}`, not thrown.
- `client.ts`: base URL, `Authorization: Key` header, 429 `Retry-After` handling, error normalization.

Response shapes not yet confirmed against a live Tediware are marked with `// CONFIRM:` comments. Keep that convention when adding provisional types.

### Inbound flow (app/api/webhooks/tediware/route.ts)

Webhooks notify only; the body is fetched separately. The handler: verify signature against **raw body bytes** before parsing -> insert into `received_documents` with `onConflictDoNothing` on `result_extid` (a replayed processed delivery is acknowledged 200 without reprocessing; a failed one is retried) -> `fetchInboundDocument` -> `resolveOrderPayload` -> `canonicalOrderSchema.parse` -> `ingestOrder` (itself idempotent on partner + poNumber). Failures return 500 so Tediware retries.

### Outbound flow (app/orders/[id]/actions.ts)

Server actions build the canonical shipment/invoice JSON from DB rows plus form data, validate with zod, call `submitTransaction`, and **always** record the attempt in `outbound_submissions` (payload, response, outcome). Order status only advances (`received` -> `shipped` -> `invoiced`) on `accepted`; rejections surface in the UI as normal outcomes.

`accepted` only means queued. Whether the document reached the partner arrives later on the partner's outbound webhook (`app/api/webhooks/tediware/outbound`) or error webhook (`.../errors`). Both send the same body, so the route is what says delivered or failed. `delivery-notification.ts` records each in `delivery_notifications` (idempotent on `result_extid`) and fetches the result for `detail.errorMessage` / `detail.errors`. Notifications join to submissions by `trace_guid`; `lib/queries.ts` derives each accepted submission's delivery state (pending, delivered, failed; latest notification wins). A failed delivery does not roll back order status; the order page shows it as a banner.

### Data layer (db/, lib/queries.ts, lib/ingest.ts)

Drizzle + better-sqlite3, synchronous API (`.get()`, `.all()`, `.run()`, `db.transaction`). Conventions:

- Columns holding Tediware-side identifiers use the `_extid` suffix, never `_id`.
- Dates/timestamps stored as ISO strings; money as `real` (a deliberately naive choice).
- `received_documents` and `outbound_submissions` are raw audit logs holding full JSON payloads; `shipments`/`invoices` are header-only and link to the submission that carried them.
- The DB file is disposable; `db:reset` is the normal path after schema changes.

Server-side data access lives in `lib/queries.ts` / `lib/ingest.ts` (marked `server-only`).

### UI

Server components by default; client components only for interactivity (forms, toasts). shadcn/ui + Tailwind. Design bar is "screenshot-able in docs", not "product". Pages: orders inbox (`app/page.tsx`), order detail with ship/invoice forms (`app/orders/[id]/`), activity log (`app/activity/`). The raw canonical JSON of every payload that crossed the wire is viewable in the UI (`components/json-viewer.tsx`). That inspectability is a core feature.

## Scope discipline

Explicitly out of scope: auth/accounts, multi-tenancy, inventory, pricing logic, partial-shipment reconciliation, emails, background jobs, EDI rendering. If a feature does not serve "order in, ship, invoice out", it does not get built.

## Style

- No emoji anywhere: code, UI copy, docs, commit messages.
- UI copy plain and concrete; no em-dashes as connectors; no filler words.
