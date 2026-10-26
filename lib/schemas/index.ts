/**
 * Canonical shapes: the app's public API and Tediware's mapping targets.
 *
 * Everything a trading partner exchange touches is expressed in these shapes.
 * They contain no EDI vocabulary and nothing specific to a single retailer.
 * See SCHEMAS.md for the human-readable contract.
 */
export * from "./common";
export * from "./order";
export * from "./shipment";
export * from "./invoice";
