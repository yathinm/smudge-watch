import { describe, expect, it } from "vitest";

import worker from "../src/index";

describe("worker", () => {
  it("exposes HTTP and scheduled handlers", () => {
    expect(worker.fetch).toBeTypeOf("function");
    expect(worker.scheduled).toBeTypeOf("function");
  });
});
