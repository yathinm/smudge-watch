import { describe, expect, it } from "vitest";

import { NordstromProductAdapter } from "../src/sources/nordstrom/product-parser";

const adapter = new NordstromProductAdapter();
const url = "https://www.nordstrom.com/s/smudge-monkey-stuffed-animal/8213030";

describe("Nordstrom product parser", () => {
  it("parses the current sold-out page", () => {
    const result = adapter.parse(
      response(`
      <main>
        <h1>Smudge Monkey Plushie</h1>
        <h2>Jellycat</h2><strong>SOLD OUT</strong>
        <p>This item is no longer available.</p>
        <p>Item #10697943</p><p>Core Product ID 333333R99P</p>
      </main>
    `),
    );

    expect(result.confidence).toBe("high");
    expect(result.products[0]).toMatchObject({
      externalId: "333333R99P",
      retailer: "nordstrom-us",
    });
    expect(result.products[0]?.variants[0]?.availability).toBe("retired");
  });

  it("uses structured product availability when available", () => {
    const result = adapter.parse(
      response(`
      <script type="application/ld+json">
        {"@type":"Product","name":"Smudge Monkey Plushie","url":"${url}","offers":{"@type":"Offer","price":"38","priceCurrency":"USD","availability":"https://schema.org/InStock"}}
      </script>
      <main><h1>Smudge Monkey Plushie</h1><p>Item #10697943</p><p>Core Product ID 333333R99P</p><button>Add to Bag</button></main>
    `),
    );

    expect(result.products[0]?.variants[0]).toMatchObject({
      priceMinor: 3800,
      currency: "USD",
      availability: "available",
    });
  });

  it("does not let related products override sold-out state", () => {
    const result = adapter.parse(
      response(`
      <main><h1>Smudge Monkey Plushie</h1><p>Sold Out</p><p>Item #10697943</p><p>Core Product ID 333333R99P</p><section>Related products <button>Add to Bag</button></section></main>
    `),
    );

    expect(result.products[0]?.variants[0]?.availability).toBe("unavailable");
  });

  it("recognizes Nordstrom's JavaScript interstitial as a challenge", () => {
    expect(() =>
      adapter.parse(response(`<script>window['istlWasHere'] = true;</script>`)),
    ).toThrowError(expect.objectContaining({ name: "ChallengePageError" }));
  });
});

function response(content: string) {
  return {
    url,
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><html><head><link rel="canonical" href="${url}"></head><body>${content}${" ".repeat(120)}</body></html>`,
  };
}
