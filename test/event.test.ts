import { describe, expect, it } from "vitest";

import type { ProductEvent } from "../src/domain/event";
import { eventFingerprint } from "../src/domain/event";

describe("event fingerprints", () => {
  it("deduplicates one transition but permits a later restock cycle", () => {
    const event: ProductEvent = {
      type: "restocked",
      sourceId: "source",
      retailer: "retailer",
      productKey: "product",
      variantKey: "variant",
      availability: "available",
      productName: "Smudge Monkey",
      purchaseUrl: "https://example.com/product",
      detectedAt: 100,
    };

    expect(eventFingerprint(event)).toBe(eventFingerprint({ ...event }));
    expect(eventFingerprint(event)).not.toBe(
      eventFingerprint({ ...event, detectedAt: 200 }),
    );
  });
});
