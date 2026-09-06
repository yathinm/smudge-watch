import { describe, expect, it, vi } from "vitest";

import {
  fetchRenderedSource,
  fetchSource,
  SourceFetchError,
} from "../src/monitoring/fetcher";
import type { StoredSource } from "../src/persistence/types";

describe("source fetcher", () => {
  it("sends validators and accepts not-modified responses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 304,
        headers: { ETag: '"new"' },
      }),
    );

    const result = await fetchSource(
      source({ etag: '"old"' }),
      Date.now(),
      fetcher,
    );

    expect(result).toMatchObject({
      notModified: true,
      status: 304,
      etag: '"new"',
    });
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("If-None-Match")).toBe('"old"');
    expect(headers.get("User-Agent")).toContain("SmudgeWatch");
  });

  it("hashes a successful HTML response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(`<html>${"product".repeat(30)}</html>`, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchSource(source(), Date.now(), fetcher);

    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.response?.body).toContain("product");
  });

  it("rejects non-allowlisted hosts before fetching", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      fetchSource(
        source({ url: "https://example.com/product" }),
        Date.now(),
        fetcher,
      ),
    ).rejects.toMatchObject({ code: "invalid_source_url" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("honors retry-after on throttled responses", async () => {
    const now = Date.now();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("slow down", {
        status: 429,
        headers: { "Content-Type": "text/plain", "Retry-After": "120" },
      }),
    );

    let caught: unknown;
    try {
      await fetchSource(source(), now, fetcher);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SourceFetchError);
    expect(caught).toMatchObject({ status: 429, retryAt: now + 120_000 });
  });

  it("returns fully rendered HTML from the browser binding", async () => {
    const body = `<html><body><h1>Smudge Monkey</h1>${"x".repeat(120)}</body></html>`;
    const quickAction = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        result: body,
        meta: {
          status: 200,
          finalUrl: "https://us.jellycat.com/smudge-monkey/",
          headers: { "content-type": "text/html" },
        },
      }),
    );

    const result = await fetchRenderedSource(source(), {
      quickAction,
    } as unknown as BrowserRun);

    expect(result.response?.body).toBe(body);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(quickAction).toHaveBeenCalledWith(
      "content",
      expect.objectContaining({
        url: "https://us.jellycat.com/smudge-monkey/",
        cacheTTL: 0,
      }),
    );
  });

  it("fails closed when the browser renderer returns an error", async () => {
    const quickAction = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { success: false, errors: [{ message: "rate limited" }] },
          { status: 429 },
        ),
      );

    await expect(
      fetchRenderedSource(source(), {
        quickAction,
      } as unknown as BrowserRun),
    ).rejects.toMatchObject({ code: "browser_http_429", status: 429 });
  });
});

function source(overrides: Partial<StoredSource> = {}): StoredSource {
  return {
    id: "jellycat-smudge-monkey",
    retailer: "jellycat-us",
    kind: "product",
    name: "Jellycat Smudge Monkey",
    url: "https://us.jellycat.com/smudge-monkey/",
    pollIntervalSeconds: 60,
    nextPollAt: 0,
    consecutiveFailures: 0,
    failureNotified: false,
    enabled: true,
    ...overrides,
  };
}
