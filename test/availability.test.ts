import { describe, expect, it } from "vitest";

import {
  availabilityFromSchema,
  availabilityFromText,
} from "../src/domain/availability";

describe("availability normalization", () => {
  it.each([
    ["https://schema.org/InStock", "available"],
    ["https://schema.org/OutOfStock", "unavailable"],
    ["https://schema.org/PreOrder", "coming_soon"],
    ["https://schema.org/Discontinued", "retired"],
  ] as const)("maps schema value %s", (value, expected) => {
    expect(availabilityFromSchema(value)).toBe(expected);
  });

  it("prefers the monitored product's sold-out state over related purchase text", () => {
    expect(availabilityFromText("SOLD OUT Related item Add to Bag")).toBe(
      "unavailable",
    );
  });
});
