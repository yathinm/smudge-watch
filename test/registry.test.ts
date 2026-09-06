import { describe, expect, it } from "vitest";

import { SOURCES } from "../src/sources/registry";

describe("source registry", () => {
  it("checks only Nordstrom every fifteen minutes", () => {
    expect(SOURCES).toEqual([
      expect.objectContaining({
        id: "nordstrom-smudge-monkey",
        retailer: "nordstrom-us",
        pollIntervalSeconds: 15 * 60,
      }),
    ]);
  });
});
