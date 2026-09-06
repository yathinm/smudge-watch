import { describe, expect, it } from "vitest";

import { ChallengePageError } from "../src/sources/errors";
import { JellycatCollectionAdapter } from "../src/sources/jellycat/collection-parser";
import { JellycatProductAdapter } from "../src/sources/jellycat/product-parser";
import { JellycatSitemapAdapter } from "../src/sources/jellycat/sitemap-parser";

const productAdapter = new JellycatProductAdapter();
const collectionAdapter = new JellycatCollectionAdapter();
const sitemapAdapter = new JellycatSitemapAdapter();

describe("Jellycat product parser", () => {
  it("extracts structured stock, price, and SKU", () => {
    const body = documentWith(`
      <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "Smudge Monkey",
          "sku": "SMG2M",
          "url": "https://us.jellycat.com/smudge-monkey/",
          "image": "https://cdn.example/monkey.jpg",
          "offers": {
            "@type": "Offer",
            "sku": "SMG2M",
            "price": "38.00",
            "priceCurrency": "USD",
            "availability": "https://schema.org/OutOfStock"
          }
        }
      </script>
      <main><h1>Smudge Monkey</h1><p>Out of Stock</p></main>
    `);

    const result = productAdapter.parse(response(body));

    expect(result.confidence).toBe("high");
    expect(result.products[0]?.variants[0]).toMatchObject({
      sku: "SMG2M",
      priceMinor: 3800,
      currency: "USD",
      availability: "unavailable",
    });
  });

  it("falls back to visible product markup", () => {
    const body = documentWith(`
      <link rel="canonical" href="https://us.jellycat.com/smudge-monkey/">
      <main class="productView">
        <h1>Smudge Monkey</h1>
        <div>SKU: SMG2M</div><div class="price">$38.00</div>
        <button>Add to Bag</button>
      </main>
    `);

    expect(
      productAdapter.parse(response(body)).products[0]?.variants[0],
    ).toMatchObject({
      sku: "SMG2M",
      priceMinor: 3800,
      availability: "available",
    });
  });

  it("rejects challenge pages", () => {
    const body = documentWith('<div id="cf-chl-widget">Just a moment...</div>');
    expect(() => productAdapter.parse(response(body))).toThrow(
      ChallengePageError,
    );
  });
});

describe("Jellycat discovery parsers", () => {
  it("extracts matching collection cards only", () => {
    const body = documentWith(`
      <main>
        <article class="card"><h3>Smudge Monkey Tiny</h3><a href="/smudge-monkey/">Smudge Monkey Tiny</a><span>$23.00</span><span>Add to Bag</span></article>
        <article class="card"><h3>Smudge Elephant</h3><a href="/smudge-elephant/">Smudge Elephant</a><span>Out of Stock</span></article>
      </main>
    `);

    const result = collectionAdapter.parse(
      response(body, "https://us.jellycat.com/collections/test"),
    );

    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.variants[0]).toMatchObject({
      priceMinor: 2300,
      availability: "available",
    });
  });

  it("discovers Smudge Monkey URLs from the sitemap", () => {
    const body = `<?xml version="1.0"?><urlset>${" ".repeat(100)}<url><loc>https://us.jellycat.com/smudge-monkey/</loc></url><url><loc>https://us.jellycat.com/smudge-elephant/</loc></url></urlset>`;
    const result = sitemapAdapter.parse(
      response(body, "https://us.jellycat.com/xmlsitemap.php"),
    );

    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.canonicalUrl).toBe(
      "https://us.jellycat.com/smudge-monkey/",
    );
  });
});

function response(
  body: string,
  url = "https://us.jellycat.com/smudge-monkey/",
) {
  return { url, status: 200, contentType: "text/html", body };
}

function documentWith(body: string): string {
  return `<!doctype html><html><head><title>Fixture</title></head><body>${body}${" ".repeat(120)}</body></html>`;
}
