import { describe, expect, it, vi } from "vitest";

import { runMonitor } from "../src/monitoring/monitor";
import type {
  EmailDelivery,
  EventRecord,
  MonitorRepository,
  SourceFailureResult,
  StatusVariant,
  StoredSource,
} from "../src/persistence/types";
import type { ProductEvent } from "../src/domain/event";

describe("monitor orchestration", () => {
  it("records a successful baseline without generating an alert", async () => {
    const source = storedSource();
    const repository = fakeRepository({ dueSources: [source] });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(productHtml("https://schema.org/InStock"), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const stats = await runMonitor(repository, undefined, {
      now: 1_000,
      fetcher,
    });

    expect(stats).toMatchObject({
      checked: 1,
      succeeded: 1,
      failed: 0,
      events: 0,
    });
    expect(repository.recordSourceSuccess).toHaveBeenCalledOnce();
    expect(repository.recordSourceFailure).not.toHaveBeenCalled();
    expect(repository.applyProducts).toHaveBeenCalledOnce();
  });

  it("creates a source failure event at the notification threshold", async () => {
    const source = storedSource({ consecutiveFailures: 2 });
    const repository = fakeRepository({
      dueSources: [source],
      failureResult: { consecutiveFailures: 3, shouldNotify: true },
      createEventResult: true,
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("unavailable", { status: 503 }));

    const stats = await runMonitor(repository, undefined, {
      now: 2_000,
      fetcher,
    });

    expect(stats).toMatchObject({
      checked: 1,
      succeeded: 0,
      failed: 1,
      events: 1,
    });
    expect(repository.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "source_failed", sourceId: source.id }),
    );
  });

  it("records recovery after a previously reported outage", async () => {
    const source = storedSource({
      consecutiveFailures: 3,
      failureNotified: true,
    });
    const repository = fakeRepository({
      dueSources: [source],
      createEventResult: true,
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(productHtml("https://schema.org/OutOfStock"), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const stats = await runMonitor(repository, undefined, {
      now: 3_000,
      fetcher,
    });

    expect(stats.events).toBe(1);
    expect(repository.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "source_recovered" }),
    );
  });

  it("uses browser rendering when a product page is challenged", async () => {
    const source = storedSource();
    const repository = fakeRepository({ dueSources: [source] });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          `<html><body><script>window['istlWasHere'] = true</script>${" ".repeat(120)}</body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        ),
      );
    const quickAction = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        result: productHtml("https://schema.org/InStock"),
        meta: { status: 200, finalUrl: source.url },
      }),
    );

    const stats = await runMonitor(repository, undefined, {
      now: 4_000,
      fetcher,
      browser: { quickAction } as unknown as BrowserRun,
    });

    expect(stats).toMatchObject({ succeeded: 1, failed: 0 });
    expect(quickAction).toHaveBeenCalledOnce();
    expect(repository.applyProducts).toHaveBeenCalledOnce();
  });

  it("uses browser rendering after a forbidden product response", async () => {
    const source = storedSource();
    const repository = fakeRepository({ dueSources: [source] });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("forbidden", { status: 403 }));
    const quickAction = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        result: productHtml("https://schema.org/OutOfStock"),
        meta: { status: 200, finalUrl: source.url },
      }),
    );

    const stats = await runMonitor(repository, undefined, {
      now: 5_000,
      fetcher,
      browser: { quickAction } as unknown as BrowserRun,
    });

    expect(stats).toMatchObject({ succeeded: 1, failed: 0 });
    expect(quickAction).toHaveBeenCalledOnce();
  });
});

function productHtml(availability: string): string {
  return `<!doctype html><html><body>${" ".repeat(120)}<script type="application/ld+json">{"@type":"Product","name":"Smudge Monkey","sku":"SMG2M","url":"https://us.jellycat.com/smudge-monkey/","offers":{"price":"38","priceCurrency":"USD","availability":"${availability}"}}</script><main><h1>Smudge Monkey</h1></main></body></html>`;
}

function storedSource(overrides: Partial<StoredSource> = {}): StoredSource {
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

function fakeRepository(options: {
  dueSources: StoredSource[];
  failureResult?: SourceFailureResult;
  createEventResult?: boolean;
}): MonitorRepository & Record<string, ReturnType<typeof vi.fn>> {
  return {
    ensureSources: vi.fn(async () => undefined),
    ensureDiscoveredProductSource: vi.fn(async () => undefined),
    listDueSources: vi.fn(async () => options.dueSources),
    acquireLease: vi.fn(async () => "lease-token"),
    releaseLease: vi.fn(async () => undefined),
    recordObservation: vi.fn(async () => undefined),
    recordSourceSuccess: vi.fn(async () => undefined),
    recordSourceFailure: vi.fn(
      async () =>
        options.failureResult ?? {
          consecutiveFailures: 1,
          shouldNotify: false,
        },
    ),
    applyProducts: vi.fn(async () => [] as ProductEvent[]),
    createEvent: vi.fn(async () => options.createEventResult ?? false),
    listPendingDeliveries: vi.fn(async () => [] as EmailDelivery[]),
    markDeliveryAccepted: vi.fn(async () => undefined),
    markDeliveryFailed: vi.fn(async () => undefined),
    startRun: vi.fn(async () => undefined),
    finishRun: vi.fn(async () => undefined),
    listStatus: vi.fn(async () => [] as StatusVariant[]),
    listEvents: vi.fn(async () => [] as EventRecord[]),
    getHealth: vi.fn(async () => ({ sources: [] })),
    cleanup: vi.fn(async () => undefined),
  };
}
