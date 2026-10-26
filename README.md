# Tedi Consumer

A small web app that plays the role of a Tediware customer: a retail supplier
that receives purchase orders from a retailer (Petco) and sends back shipments
and invoices. It exists to exercise Tediware's APIs and webhooks from the seat of
an integrating developer, and to serve as a reference for how a naive supplier
would integrate.

The app never sees raw EDI. It speaks only canonical JSON; Tediware maps to and
from the retailer's EDI dialect. The document loop is:

- Order in: an 850 purchase order arrives as a webhook, and the app fetches the
  canonical order and shows it in the inbox.
- Ship: the user ships an order; the app POSTs a canonical shipment (856).
- Invoice: the user invoices a shipped order; the app POSTs a canonical invoice
  (810).

See `SCHEMAS.md` for the canonical shapes and `AGENTS.md` for architecture and
conventions.

## Stack

Next.js (App Router) + TypeScript, shadcn/ui + Tailwind, SQLite via Drizzle. No
auth (single local user). All Tediware access is isolated in `lib/tediware/`.

## Setup

Requires Node 20.18+ (an `.nvmrc` pins 20.20.2; run `nvm use`).

```bash
npm install
cp .env.example .env.local   # optional; the app runs without any config
npm run db:migrate           # create the SQLite database
npm run db:seed              # load a few fake Petco orders
npm run dev                  # http://localhost:3007
```

The database file (`data/tedi.db`) is disposable. Reset it any time:

```bash
npm run db:reset             # rm + migrate + seed
```

## Running without Tediware

Everything through the ship/invoice loop works with no configuration:

- The inbox shows seeded orders.
- Ship and Invoice validate and store the canonical JSON; the submission to
  Tediware is stubbed as accepted (visible on the order and in Activity).
- The webhook can be exercised locally with a signed fixture. Set
  `TEDIWARE_WEBHOOK_SECRET` to any value in `.env.local`, restart, then:

```bash
npm run webhook:send                 # creates order PET-900001
npm run webhook:send                 # same id again: acknowledged as duplicate
npm run webhook:send -- 900002       # a different id: a new order
```

The harness writes a result fixture under `fixtures/results/` and POSTs a signed
webhook; the app verifies the signature, records the delivery, reads the fixture
in place of a live result fetch, and creates the order.

## Running against a live Tediware

Fill in `.env.local` (see `.env.example`):

| Variable                  | Enables                                          |
| ------------------------- | ------------------------------------------------ |
| `TEDIWARE_WEBHOOK_SECRET` | Inbound webhook signature verification.          |
| `TEDIWARE_BASE_URL`       | Live result fetch (with `TEDIWARE_API_KEY`).     |
| `TEDIWARE_API_KEY`        | Auth for result fetch and outbound submission.   |
| `TEDIWARE_PARTNER_KEY`    | Live outbound submission (with base URL + key).  |

The outbound and error webhooks each have their own secret in Tediware. Set
`TEDIWARE_OUTBOUND_WEBHOOK_SECRET` and `TEDIWARE_ERROR_WEBHOOK_SECRET` when they
differ from `TEDIWARE_WEBHOOK_SECRET`; each falls back to it when unset.

The server prints a configuration summary at startup showing which capabilities
are live versus local/stubbed. Point Tediware's webhooks at:

| Route                                  | Tediware webhook                            |
| -------------------------------------- | ------------------------------------------- |
| `POST /api/webhooks/tediware`          | Inbound documents (850 purchase orders).    |
| `POST /api/webhooks/tediware/outbound` | Outbound delivered (856/810 reached Petco). |
| `POST /api/webhooks/tediware/errors`   | Outbound failed.                            |

## Layout

```
app/
  page.tsx                     Orders inbox (landing)
  orders/[id]/                 Order detail, ship/invoice forms and actions
  activity/                    Inbound deliveries and outbound submissions
  api/webhooks/tediware/       Inbound, outbound-delivered, and error webhooks
lib/
  schemas/                     Canonical order/shipment/invoice (zod + types)
  tediware/                    The only code that touches Tediware (SDK draft)
  queries.ts, ingest.ts        Server-side data access and order ingestion
db/
  schema.ts, migrate.ts, seed.ts
```

## Scripts

| Command                  | Does                                             |
| ------------------------ | ------------------------------------------------ |
| `npm run dev`            | Start the dev server.                            |
| `npm run build`          | Production build (forces `NODE_ENV=production`). |
| `npm run typecheck`      | `tsc --noEmit`.                                  |
| `npm run db:migrate`     | Apply migrations.                                |
| `npm run db:seed`        | Seed fake orders.                                |
| `npm run db:reset`       | Delete, migrate, and reseed the database.        |
| `npm run webhook:send`   | Send a signed fixture webhook to the app.        |
