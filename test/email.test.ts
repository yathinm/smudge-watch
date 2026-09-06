import { describe, expect, it, vi } from "vitest";

import type { ProductEvent } from "../src/domain/event";
import { sendWithResend, EmailSendError } from "../src/email/resend-client";
import { eventEmail } from "../src/email/templates";

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
