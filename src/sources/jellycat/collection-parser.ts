import { load } from "cheerio";

import type { AnyNode } from "domhandler";
import type {
  ParseResult,
  ParsedProduct,
  SourceAdapter,
  SourceResponse,
} from "../../domain/product";
import {
  assertUsableHtml,
  canonicalUrl,
  normalizedKey,
  parsePriceMinor,
  productAvailability,
} from "../helpers";

export class JellycatCollectionAdapter implements SourceAdapter {
  parse(response: SourceResponse): ParseResult {
    assertUsableHtml(response.body);
    const $ = load(response.body);
    const products = new Map<string, ParsedProduct>();
    const cards = $("article, .card, .product, [data-product-id], li");

    cards.each((_index: number, node: AnyNode) => {
      const card = $(node);
      const name = card
        .find("h2, h3, .card-title, [data-product-title]")
        .first()
        .text()
        .trim();
      if (!isSmudgeMonkey(name)) return;
      const link = card
        .find("a[href]")
        .filter((_i, anchor) => isSmudgeMonkey($(anchor).text()))
        .first();
      const href =
        link.attr("href") ?? card.find("a[href]").first().attr("href");
      if (!href) return;

      const url = canonicalUrl(href, response.url);
      const text = card.text();
      const key = normalizedKey(new URL(url).pathname);
      products.set(key, {
        key,
        retailer: "jellycat-us",
        name,
        canonicalUrl: url,
        variants: [
          {
            key: "listing",
            name,
            ...(parsePriceMinor(text) === undefined
              ? {}
              : { priceMinor: parsePriceMinor(text) }),
            currency: "USD",
            availability: productAvailability(text),
            purchaseUrl: url,
          },
        ],
      });
    });

    if (products.size === 0) {
      $("a[href]").each((_index: number, node: AnyNode) => {
        const anchor = $(node);
        const name = anchor.text().replace(/\s+/g, " ").trim();
        if (!isSmudgeMonkey(name)) return;
        const href = anchor.attr("href");
        if (!href) return;
        const url = canonicalUrl(href, response.url);
        const key = normalizedKey(new URL(url).pathname);
        products.set(key, {
          key,
          retailer: "jellycat-us",
          name,
          canonicalUrl: url,
          variants: [
            {
              key: "listing",
              name,
              availability: "unknown",
              purchaseUrl: url,
            },
          ],
        });
      });
    }

    return {
      confidence: products.size > 0 ? "medium" : "low",
      products: [...products.values()],
    };
  }
}

function isSmudgeMonkey(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes("smudge") && normalized.includes("monkey");
}
