import { describe, expect, it, vi } from "vitest";

import type { ProductEvent } from "../src/domain/event";
import { deliverPendingEmails } from "../src/email/delivery";
import { sendWithResend, EmailSendError } from "../src/email/resend-client";
import { eventEmail } from "../src/email/templates";
import type { MonitorRepository } from "../src/persistence/types";

const config = {
  apiKey: "secret-key-used-only-in-test",
  to: "owner@example.com",
  from: "SmudgeWatch <onboarding@resend.dev>",
};

describe("email templates", () => {
  it("builds text and HTML restock alerts", () => {
    const content = eventEmail(restockEvent());

    expect(content.subject).toBe("Smudge Monkey restocked at Nordstrom");
    expect(content.text).toContain("https://www.nordstrom.com/s/product/123");
    expect(content.html).toContain("Open product");
    expect(content.html).not.toContain(config.apiKey);
  });

  it("escapes untrusted product names", () => {
    const content = eventEmail({
      ...restockEvent(),
      productName: '<script>alert("x")</script>',
    });
    expect(content.html).not.toContain("<script>");
    expect(content.html).toContain("&lt;script&gt;");
  });
});

describe("Resend client", () => {
  it("sends both HTML and text and returns the provider ID", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: "email_123" }, { status: 200 }));

    await expect(
      sendWithResend(config, eventEmail(restockEvent()), "event-key", fetcher),
    ).resolves.toBe("email_123");

    const request = fetcher.mock.calls[0];
    const headers = new Headers(request?.[1]?.headers);
    const payload = JSON.parse(String(request?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(headers.get("Authorization")).toBe(`Bearer ${config.apiKey}`);
    expect(headers.get("Idempotency-Key")).toBe("event-key");
    expect(payload).toMatchObject({ to: [config.to], from: config.from });
    expect(payload["html"]).toBeTypeOf("string");
    expect(payload["text"]).toBeTypeOf("string");
  });

  it("classifies invalid credentials as permanent", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ message: "invalid API key" }, { status: 403 }),
      );

    let caught: unknown;
    try {
      await sendWithResend(
        config,
        eventEmail(restockEvent()),
        "event-key",
        fetcher,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EmailSendError);
    expect(caught).toMatchObject({
      permanent: true,
      message: "invalid API key",
    });
  });
});

describe("email delivery", () => {
  it("marks an accepted delivery with its provider ID", async () => {
    const repository = deliveryRepository();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ id: "email_accepted" }, { status: 200 }),
      );

    await expect(
      deliverPendingEmails(repository, config, 1_000, fetcher),
    ).resolves.toEqual({
      accepted: 1,
      failed: 0,
    });
    expect(repository.markDeliveryAccepted).toHaveBeenCalledWith(
      "event-fingerprint",
      "email_accepted",
      1_000,
    );
  });

  it("schedules retry after a temporary failure", async () => {
    const repository = deliveryRepository();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ message: "rate limited" }, { status: 429 }),
      );

    await deliverPendingEmails(repository, config, 2_000, fetcher);

    expect(repository.markDeliveryFailed).toHaveBeenCalledWith(
      "event-fingerprint",
      "rate limited",
      62_000,
      2_000,
    );
  });

  it("keeps deliveries queued when email is not configured", async () => {
    const repository = deliveryRepository();
    await expect(
      deliverPendingEmails(repository, undefined, 1_000),
    ).resolves.toEqual({
      accepted: 0,
      failed: 0,
    });
    expect(repository.listPendingDeliveries).not.toHaveBeenCalled();
  });
});

function restockEvent(): ProductEvent {
  return {
    type: "restocked",
    sourceId: "nordstrom-smudge-monkey",
    retailer: "nordstrom-us",
    productKey: "smudge-monkey",
    variantKey: "333333r99p",
    productName: "Smudge Monkey Plushie",
    availability: "available",
    priceMinor: 3800,
    currency: "USD",
    purchaseUrl: "https://www.nordstrom.com/s/product/123",
    detectedAt: Date.UTC(2026, 8, 5, 20, 0),
  };
}

function deliveryRepository(): MonitorRepository {
  return {
    listPendingDeliveries: vi.fn(async () => [
      {
        eventFingerprint: "event-fingerprint",
        event: restockEvent(),
        attemptCount: 0,
      },
    ]),
    markDeliveryAccepted: vi.fn(async () => undefined),
    markDeliveryFailed: vi.fn(async () => undefined),
  } as unknown as MonitorRepository;
}
