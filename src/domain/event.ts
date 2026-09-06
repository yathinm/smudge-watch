import type { Availability } from "./availability";

export const EVENT_TYPES = [
  "product_discovered",
  "variant_discovered",
  "restocked",
  "sold_out",
  "price_changed",
  "source_failed",
  "source_recovered",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface ProductEvent {
  type: EventType;
  sourceId: string;
  retailer: string;
  productKey: string;
  variantKey?: string;
  productName: string;
  variantName?: string;
  previousAvailability?: Availability;
  availability?: Availability;
  previousPriceMinor?: number;
  priceMinor?: number;
  currency?: string;
  purchaseUrl: string;
  detectedAt: number;
}

export function eventFingerprint(event: ProductEvent): string {
  return [
    event.sourceId,
    event.productKey,
    event.variantKey ?? "product",
    event.type,
    event.availability ?? "none",
    event.priceMinor ?? "none",
    event.detectedAt,
  ].join(":");
}
