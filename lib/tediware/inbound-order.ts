import { getPartnerKey } from "./env"

/**
 * Final-mile translation: Tediware's inbound 850 JSON -> the app's canonical
 * order shape.
 *
 * Inbound mappings on the Tediware side map to an implementation (a spec), so
 * the delivered document is X12-shaped JSON: heading/detail/summary sections,
 * segment keys like `beginning_segment_for_purchase_order_BEG`, elements keyed
 * by position (`purchase_order_number_03`), and bare code values ("SA", "EA").
 * That shape is stable across trading partners and releases; turning it into
 * this app's own vocabulary is the integrator's job, and this module is it.
 *
 * Everything here selects by X12 position and qualifier code, never by a
 * partner-specific value, so retailer #2 flows through unchanged as long as its
 * inbound mapping targets the same 850 implementation. Expected loop layout:
 * one self-contained N1 loop entry per party (the ship-to entry carries entity
 * code "ST" with its own N3/N4 nested inside).
 */

type Rec = Record<string, unknown>

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Segments that occur once arrive as an object, repeated ones as an array. */
function asArray(value: unknown): Rec[] {
  if (Array.isArray(value)) return value.filter(isRecord)
  return isRecord(value) ? [value] : []
}

/**
 * Key names carry a human-readable prefix that could change between
 * implementations (`beginning_segment_for_purchase_order_BEG`), so segments and
 * elements are looked up by their stable suffix: the segment tag or the
 * two-digit element position.
 */
function bySuffix(record: Rec | undefined, suffix: string): unknown {
  if (!record) return undefined
  const key = Object.keys(record).find((k) => k.endsWith(suffix))
  return key === undefined ? undefined : record[key]
}

function segment(section: Rec | undefined, tag: string): Rec | undefined {
  return asArray(bySuffix(section, `_${tag}`))[0]
}

function element(seg: Rec | undefined, position: string): unknown {
  return bySuffix(seg, `_${position}`)
}

function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value.trim()
  if (typeof value === "number") return String(value)
  return undefined
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/** X12 dates are CCYYMMDD; the canonical shape wants ISO "2026-07-02". */
function x12Date(value: unknown): string | undefined {
  const text = str(value)
  if (!text || !/^\d{8}$/.test(text)) return undefined
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
}

/**
 * DTM qualifiers accepted as "the date the retailer wants this shipped", in
 * preference order: 010 requested ship, 118 requested pick-up, 106 required by.
 */
const SHIP_DATE_QUALIFIERS = ["010", "118", "106"]

/**
 * Product/service id qualifiers for the canonical `sku`, best first: the
 * supplier's own item number (VN vendor's item, VA vendor's alphanumeric,
 * VP vendor's part number), then universal codes a supplier can key on when
 * the retailer sends no vendor number (UK GTIN-14, UP UPC, EN EAN, UA case
 * UPC). Kroger, for one, sends only its own item code plus a GTIN.
 */
const SKU_QUALIFIERS = ["VN", "VA", "VP", "UK", "UP", "EN", "UA"]
/**
 * Qualifiers meaning "the retailer's number for the same item": PI purchaser's
 * item code, SK stock keeping unit, BP buyer's part number, IN buyer's item
 * number.
 */
const BUYER_ITEM_QUALIFIERS = ["PI", "SK", "BP", "IN"]

/** True when a document looks like the X12-shaped 850 rather than a canonical order. */
export function isTranslated850(document: unknown): document is Rec {
  return (
    isRecord(document) &&
    !("poNumber" in document) &&
    ("heading" in document || "detail" in document)
  )
}

/**
 * Builds the canonical order object from a translated 850. Returns a plain
 * object; the caller validates it with canonicalOrderSchema, so this stays
 * lenient and lets zod name any field that came out empty.
 */
export function translateInbound850(document: Rec, partner: string): Rec {
  const heading = isRecord(document.heading) ? document.heading : undefined
  const detail = isRecord(document.detail) ? document.detail : undefined

  const beg = segment(heading, "BEG")
  if (!beg) {
    throw new Error(
      "Inbound 850 has no BEG segment in heading; cannot read the PO number."
    )
  }

  const dtms = asArray(bySuffix(heading, "_DTM"))
  let requestedShipDate: string | undefined
  for (const qualifier of SHIP_DATE_QUALIFIERS) {
    const hit = dtms.find((d) => str(element(d, "01")) === qualifier)
    if (hit) {
      requestedShipDate = x12Date(element(hit, "02"))
      break
    }
  }

  // One loop entry per party; the ship-to entry is the one whose N1 entity
  // identifier code is ST, with its own N3/N4 alongside.
  const n1Entries = asArray(bySuffix(heading, "_N1_loop"))
  let shipToEntry: Rec | undefined
  let shipToN1: Rec | undefined
  for (const entry of n1Entries) {
    const n1 = asArray(bySuffix(entry, "_N1")).find(
      (n) => str(element(n, "01")) === "ST"
    )
    if (n1) {
      shipToEntry = entry
      shipToN1 = n1
      break
    }
  }
  if (!shipToEntry || !shipToN1) {
    throw new Error(
      'Inbound 850 has no ship-to party (no N1 loop entry with entity code "ST").'
    )
  }
  const n3s = asArray(bySuffix(shipToEntry, "_N3"))
  const n4 = segment(shipToEntry, "N4")

  // The retailer's number for us as a supplier: a REF with qualifier IA
  // (internal vendor number) when the order carries one, otherwise the
  // identification code on the vendor (VN) party.
  const vendorRef = asArray(bySuffix(heading, "_REF")).find(
    (r) => str(element(r, "01")) === "IA"
  )
  let vendorNumber = str(element(vendorRef, "02"))
  if (!vendorNumber) {
    for (const entry of n1Entries) {
      const n1 = asArray(bySuffix(entry, "_N1")).find(
        (n) => str(element(n, "01")) === "VN"
      )
      vendorNumber = str(element(n1, "04"))
      if (vendorNumber) break
    }
  }

  const lines = asArray(bySuffix(detail, "_PO1_loop"))
  if (lines.length === 0) {
    throw new Error("Inbound 850 has no PO1 line items in detail.")
  }
  const lineItems = lines.map((entry, index) => {
    const po1 = segment(entry, "PO1")

    // PO1 carries product ids as qualifier/id pairs in elements 06/07, 08/09,
    // ... up to 24/25. Collect them, then pick by qualifier.
    const productIds = new Map<string, string>()
    for (let position = 6; position <= 24; position += 2) {
      const qualifier = str(element(po1, String(position).padStart(2, "0")))
      const id = str(element(po1, String(position + 1).padStart(2, "0")))
      if (qualifier && id) productIds.set(qualifier, id)
    }
    const sku = SKU_QUALIFIERS.map((q) => productIds.get(q)).find(Boolean)
    const buyerItemNumber = BUYER_ITEM_QUALIFIERS.map((q) =>
      productIds.get(q)
    ).find(Boolean)

    const pid = segment(asArray(bySuffix(entry, "_PID_loop"))[0], "PID")

    return {
      lineNumber: num(element(po1, "01")) ?? index + 1,
      sku,
      buyerItemNumber,
      description: str(element(pid, "05")),
      quantityOrdered: num(element(po1, "02")),
      unitOfMeasure: str(element(po1, "03")),
      unitPrice: num(element(po1, "04")),
    }
  })

  return {
    poNumber: str(element(beg, "03")),
    partner,
    orderDate: x12Date(element(beg, "05")),
    vendorNumber,
    requestedShipDate: requestedShipDate ?? null,
    currency: str(element(segment(heading, "CUR"), "02")) ?? "USD",
    shipTo: {
      name: str(element(shipToN1, "02")),
      address1: str(element(n3s[0], "01")),
      address2: str(element(n3s[0], "02")) ?? str(element(n3s[1], "01")),
      city: str(element(n4, "01")),
      state: str(element(n4, "02")),
      postalCode: str(element(n4, "03")),
      country: str(element(n4, "04")) ?? "US",
      locationId: str(element(shipToN1, "04")),
    },
    lineItems,
  }
}

/**
 * Normalizes a downloaded inbound document to the canonical order shape.
 * A live document is the X12-shaped 850 and gets translated; a local fixture is
 * already canonical and passes through. Either way the caller still validates
 * with canonicalOrderSchema.
 *
 * The document itself does not say which trading partner it came from. Newer
 * Tediware builds put the partner key on the result detail (`partner.key`),
 * which the caller passes as `partnerKey`; older builds do not, and the
 * configured partner key stands in.
 */
export function resolveOrderPayload(
  document: unknown,
  partnerKey?: string,
): unknown {
  if (isTranslated850(document)) {
    const partner = partnerKey?.trim() || getPartnerKey()
    return translateInbound850(document, partner.toLowerCase())
  }
  return document
}
