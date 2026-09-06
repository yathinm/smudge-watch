import { describe, expect, it } from "vitest";

import worker from "../src/index";

describe("worker", () => {
  it("reports its initialization status", async () => {
    const response = await worker.fetch();

    await expect(response.json()).resolves.toEqual({
      name: "SmudgeWatch",
      status: "initializing",
    });
  });
});
