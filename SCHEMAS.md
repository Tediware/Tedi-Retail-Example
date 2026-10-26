# Canonical Shapes

These are the JSON shapes this app exchanges with Tediware. They are the app's
public API and, for the Tediware side, the mapping targets: inbound mappings must
produce the order shape, outbound mappings must accept the shipment and invoice
shapes.

The source of truth is the zod schemas in `lib/schemas/`. This document mirrors
them for people. If the two disagree, the code wins; update this file.

## Design rules

1. Field names are plain business language a supplier would use. No EDI vocabulary
   (no segment names, element positions, or qualifier codes).
2. Nothing exists here only because one retailer's spec asks for it. Petco-specific
   requirements are resolved in Tediware mapping, not by adding fields here.
3. Adding a second retailer must require zero changes to these shapes. If a new
   partner cannot be mapped into them, that is a mapping problem or a genuinely
   missing generic field, decided case by case.

## Conventions

- Dates without a time are ISO calendar dates: `"2026-07-06"`.
- Timestamps carry a timezone offset: `"2026-07-06T14:30:00Z"`.
- Money is a decimal number in the document's currency: `42.50`. Not minor units.
- `currency` is a three-letter code and defaults to `"USD"` when omitted.
- `unitOfMeasure` is free text (`"EA"`, `"CS"`, ...). It is not an enum because
  retailers use different codes and Tediware normalizes them.
- `sku` is always the supplier's own item number. The retailer's number, when
  present, is `buyerItemNumber`.

---

## Order (inbound)

Delivered by Tediware after it maps a retailer purchase order. The app receives
this; it never sees the raw 850.

| Field               | Type            | Required | Notes                                        |
| ------------------- | --------------- | -------- | -------------------------------------------- |
| `poNumber`          | string          | yes      | Retailer PO number, unique per partner.      |
| `partner`           | string          | yes      | Trading partner key, e.g. `"petco"`.         |
| `orderDate`         | date            | yes      |                                              |
| `vendorNumber`      | string          | no       | The retailer's number for us as a supplier.  |
| `requestedShipDate` | date or null    | no       | When the retailer wants it shipped.          |
| `currency`          | string(3)       | no       | Defaults to `"USD"`.                          |
| `shipTo`            | Address         | yes      | Delivery destination.                        |
| `lineItems`         | OrderLine[]     | yes      | At least one.                                |
| `notes`             | string          | no       | Free-text instructions from the retailer.    |

**OrderLine**

| Field             | Type      | Required | Notes                                         |
| ----------------- | --------- | -------- | --------------------------------------------- |
| `lineNumber`      | int > 0   | yes      | 1-based position within the order.            |
| `sku`             | string    | yes      | Supplier's item number.                       |
| `buyerItemNumber` | string    | no       | Retailer's item number for the same product.  |
| `description`     | string    | yes      |                                               |
| `quantityOrdered` | number    | yes      | Non-negative.                                 |
| `unitOfMeasure`   | string    | yes      | e.g. `"EA"`, `"CS"`.                           |
| `unitPrice`       | number    | yes      | Per unit, in `currency`.                       |

```json
{
  "poNumber": "PET-4471",
  "partner": "petco",
  "orderDate": "2026-07-01",
  "vendorNumber": "2781",
  "requestedShipDate": "2026-07-10",
  "currency": "USD",
  "shipTo": {
    "name": "Petco DC 07",
    "address1": "1 Distribution Way",
    "city": "San Antonio",
    "state": "TX",
    "postalCode": "78218",
    "country": "US",
    "locationId": "1207"
  },
  "lineItems": [
    {
      "lineNumber": 1,
      "sku": "SKU-100",
      "buyerItemNumber": "PET-9001",
      "description": "Cat tree, 48in",
      "quantityOrdered": 24,
      "unitOfMeasure": "EA",
      "unitPrice": 42.5
    }
  ]
}
```

---

## Shipment (outbound)

Built by the app when the user ships an order and POSTed to Tediware, which
generates the 856. The shipment describes the physical packing: which items
went into which carton, and which cartons ride on which pallet. Those are
facts only the supplier knows (a mapping cannot invent SSCC barcodes or carton
contents).

The packing is shaped the way ERP and WMS systems export it, not the way an
ASN consumes it: item detail appears once on `lineItems`, carton contents are
bare line references, and the pallet hierarchy is expressed by reference
(`palletSscc` on the carton), not by nesting. Rendering a retailer's ASN
hierarchy from this is the mapping's job: join contents back to lines for item
detail, group cartons by pallet for a tare level, aggregate counts, and
collapse or skip levels where a retailer's structure differs.

| Field                   | Type            | Required | Notes                                    |
| ----------------------- | --------------- | -------- | ---------------------------------------- |
| `poNumber`              | string          | yes      | Order being fulfilled.                   |
| `shipmentNumber`        | string          | yes      | Supplier-generated. This app generates a numeric string of at most 10 characters, the most restrictive partner constraint seen. |
| `shipDate`              | date            | yes      |                                          |
| `estimatedDeliveryDate` | date            | no       | Expected arrival.                        |
| `carrier`               | string          | yes      | Carrier name, e.g. `"UPS"`.              |
| `scac`                  | string(2-4)     | no       | Standard Carrier Alpha Code, e.g. `"UPSN"`. |
| `trackingNumber`        | string          | no       |                                          |
| `billOfLadingNumber`    | string          | no       |                                          |
| `totalWeight`           | number > 0      | no       | In `weightUnit`.                         |
| `weightUnit`            | string          | no       | e.g. `"LB"`.                             |
| `shipFrom`              | Address         | no       | Origin; supplier default if omitted.     |
| `shipTo`                | Address         | yes      | Normally copied from the order.          |
| `lineItems`             | ShipmentLine[]  | yes      | What shipped, per line. At least one. The only place item detail appears. |
| `pallets`               | Pallet[]        | no       | Pallet labels; absent for unpalletized freight. |
| `cartons`               | Carton[]        | yes      | Every carton, palletized or loose. At least one. |

Packing rules, enforced by the schema:

- Carton contents reference `lineItems` by `lineNumber`; every referenced line
  must exist, and per line the content quantities must sum to the
  `quantityShipped` total.
- A palletized carton names its pallet in `palletSscc`; a loose carton omits
  it. Every `palletSscc` must match an entry in `pallets`, and every pallet
  must be referenced by at least one carton. Palletized and loose cartons can
  mix in one shipment.
- SSCC labels must be unique across all pallets and cartons.

**ShipmentLine**

| Field             | Type    | Required | Notes                                  |
| ----------------- | ------- | -------- | -------------------------------------- |
| `lineNumber`      | int > 0 | yes      | Matches the order line fulfilled.      |
| `sku`             | string  | yes      | Supplier's item number.                |
| `buyerItemNumber` | string  | no       | Retailer's item number, when known.    |
| `description`     | string  | yes      |                                        |
| `quantityShipped` | number  | yes      | Non-negative.                          |
| `unitOfMeasure`   | string  | yes      |                                        |

**Pallet**

| Field  | Type   | Required | Notes                              |
| ------ | ------ | -------- | ---------------------------------- |
| `sscc` | string | yes      | 18-digit SSCC on the pallet label. |

**Carton**

| Field        | Type            | Required | Notes                                       |
| ------------ | --------------- | -------- | ------------------------------------------- |
| `sscc`       | string          | yes      | 18-digit SSCC on the carton label.          |
| `palletSscc` | string          | no       | Pallet this carton rides on; loose if absent. |
| `contents`   | CartonContent[] | yes      | At least one.                               |

**CartonContent**

A reference, not a copy: item detail lives on the shipment line this points
at. Lot and expiration stay here because they are facts about the physical
units in this carton.

| Field            | Type    | Required | Notes                              |
| ---------------- | ------- | -------- | ---------------------------------- |
| `lineNumber`     | int > 0 | yes      | Shipment line this fulfills.       |
| `quantity`       | number  | yes      | Quantity in this carton.           |
| `lotNumber`      | string  | no       | For goods that carry one.          |
| `expirationDate` | date    | no       | For perishables.                   |

```json
{
  "poNumber": "PET-4471",
  "shipmentNumber": "1783947600",
  "shipDate": "2026-07-08",
  "estimatedDeliveryDate": "2026-07-12",
  "carrier": "UPS",
  "scac": "UPSN",
  "trackingNumber": "1Z999AA10123456784",
  "billOfLadingNumber": "BOL-88123",
  "totalWeight": 260,
  "weightUnit": "LB",
  "shipTo": {
    "name": "Petco DC 07",
    "address1": "1 Distribution Way",
    "city": "San Antonio",
    "state": "TX",
    "postalCode": "78218",
    "country": "US"
  },
  "lineItems": [
    {
      "lineNumber": 1,
      "sku": "SKU-100",
      "buyerItemNumber": "PET-9001",
      "description": "Cat tree, 48in",
      "quantityShipped": 24,
      "unitOfMeasure": "EA"
    }
  ],
  "pallets": [{ "sscc": "009999990000000033" }],
  "cartons": [
    {
      "sscc": "009999990000000019",
      "palletSscc": "009999990000000033",
      "contents": [{ "lineNumber": 1, "quantity": 12 }]
    },
    {
      "sscc": "009999990000000026",
      "palletSscc": "009999990000000033",
      "contents": [{ "lineNumber": 1, "quantity": 12 }]
    }
  ]
}
```

---

## Invoice (outbound)

Built by the app when the user invoices a shipped order and POSTed to Tediware,
which generates the 810. Tax and allowance/charge modeling are intentionally out
of scope; `total` equals `subtotal` until such a need appears.

| Field              | Type           | Required | Notes                                 |
| ------------------ | -------------- | -------- | ------------------------------------- |
| `poNumber`         | string         | yes      | Order being billed.                   |
| `orderDate`        | date           | yes      | Date of the order being billed.       |
| `vendorNumber`     | string         | no       | From the order, when it carried one.  |
| `invoiceNumber`    | string         | yes      | Supplier-generated.                   |
| `invoiceDate`      | date           | yes      |                                       |
| `shipTo`           | Address        | yes      | Copied from the order.                |
| `shipmentNumber`   | string         | no       | The shipment this bills for.          |
| `currency`         | string(3)      | no       | Defaults to `"USD"`.                   |
| `paymentTermsDays` | int >= 0       | no       | Net terms in days, e.g. `30`.         |
| `lineItems`        | InvoiceLine[]  | yes      | At least one.                         |
| `subtotal`         | number         | yes      | Sum of line totals.                   |
| `total`            | number         | yes      | Amount due.                           |

**InvoiceLine**

| Field              | Type    | Required | Notes                                   |
| ------------------ | ------- | -------- | --------------------------------------- |
| `lineNumber`       | int > 0 | yes      | Matches the order line billed.          |
| `sku`              | string  | yes      |                                         |
| `buyerItemNumber`  | string  | no       | Retailer's item number, when known.     |
| `description`      | string  | yes      |                                         |
| `quantityInvoiced` | number  | yes      | Non-negative.                           |
| `unitOfMeasure`    | string  | yes      |                                         |
| `unitPrice`        | number  | yes      | Per unit, in `currency`.                 |
| `lineTotal`        | number  | yes      | `quantityInvoiced * unitPrice`.         |

```json
{
  "poNumber": "PET-4471",
  "orderDate": "2026-07-01",
  "vendorNumber": "2781",
  "invoiceNumber": "INV-4471",
  "invoiceDate": "2026-07-09",
  "shipTo": {
    "name": "Petco DC 07",
    "address1": "1 Distribution Way",
    "city": "San Antonio",
    "state": "TX",
    "postalCode": "78218",
    "country": "US",
    "locationId": "1207"
  },
  "shipmentNumber": "SHP-4471-1",
  "currency": "USD",
  "paymentTermsDays": 30,
  "lineItems": [
    {
      "lineNumber": 1,
      "sku": "SKU-100",
      "buyerItemNumber": "PET-9001",
      "description": "Cat tree, 48in",
      "quantityInvoiced": 24,
      "unitOfMeasure": "EA",
      "unitPrice": 42.5,
      "lineTotal": 1020.0
    }
  ],
  "subtotal": 1020.0,
  "total": 1020.0
}
```

---

## Address

| Field        | Type   | Required | Notes                       |
| ------------ | ------ | -------- | --------------------------- |
| `name`       | string | yes      |                             |
| `address1`   | string | yes      |                             |
| `address2`   | string | no       |                             |
| `city`       | string | yes      |                             |
| `state`      | string | yes      | State or region.            |
| `postalCode` | string | yes      |                             |
| `country`    | string | no       | Defaults to `"US"`.          |
| `locationId` | string | no       | Retailer's code for the location (store or DC number), from the order. |

## Open questions for the Tediware side

- Does the inbound mapping populate `buyerItemNumber` from the retailer's item
  reference, or only `sku`? The app tolerates `buyerItemNumber` being absent.
- Should `shipTo` on the shipment be trusted from the app, or re-derived from the
  order on the Tediware side? The app sends it for self-containment.
