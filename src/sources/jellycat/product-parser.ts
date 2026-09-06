import { load } from "cheerio";

import type {
  ParseResult,
  ParsedProduct,
  SourceAdapter,
  SourceResponse,
} from "../../domain/product";
import { SourceParseError } from "../errors";
import {
  absoluteUrl,
  assertUsableHtml,
  asString,
  canonicalUrl,
  isProductRecord,
  jsonLdRecords,
  normalizedKey,
  parsePriceMinor,
  productAvailability,
  variantsFromProductRecord,
} from "../helpers";

export class JellycatProductAdapter implements SourceAdapter {
  parse(response: SourceResponse): ParseResult {
    assertUsableHtml(response.body);

    const structured = jsonLdRecords(response.body).find(
      (record) =>
        isProductRecord(record) &&
        asString(record["name"])?.toLowerCase().includes("smudge monkey"),
    );

    if (structured) {
      const name = asString(structured["name"]) ?? "Smudge Monkey";
      const url = canonicalUrl(
        asString(structured["url"]) ?? response.url,
        response.url,
      );
      const externalId = asString(structured["productID"]);
      const image = Array.isArray(structured["image"])
        ? asString(structured["image"][0])
        : asString(structured["image"]);

      return {
        confidence: "high",
        products: [
          {
            key: normalizedKey(externalId ?? new URL(url).pathname),
            ...(externalId ? { externalId } : {}),
            retailer: "jellycat-us",
            name,
            canonicalUrl: url,
            ...(image ? { imageUrl: absoluteUrl(image, response.url) } : {}),
            variants: variantsFromProductRecord(structured, response.url),
          },
        ],
      };
    }

    return this.parseVisibleProduct(response);
  }

  private parseVisibleProduct(response: SourceResponse): ParseResult {
    const $ = load(response.body);
    const main = $("main, .productView, [data-product]").first();
    const scope = main.length ? main : $("body").first();
    const name = scope.find("h1").first().text().replace(/\s+/g, " ").trim();
    if (!name.toLowerCase().includes("smudge monkey")) {
      throw new SourceParseError("Jellycat product title was not found");
    }

    const text = scope.text();
    const skuMatch = text.match(/SKU:\s*([A-Z0-9-]+)/i);
    const sku = skuMatch?.[1];
    const price = parsePriceMinor(
      scope
        .find('[itemprop="price"], .price, .productView-price')
        .first()
        .text() || text,
    );
    const availability = productAvailability(text);
    const canonical = canonicalUrl(
      $('link[rel="canonical"]').attr("href") ?? response.url,
      response.url,
    );
    const variantName = sku ? `${name} (${sku})` : name;

    const product: ParsedProduct = {
      key: normalizedKey(new URL(canonical).pathname),
      retailer: "jellycat-us",
      name,
      canonicalUrl: canonical,
      variants: [
        {
          key: normalizedKey(sku ?? name),
          ...(sku ? { sku, externalId: sku } : {}),
          name: variantName,
          ...(price === undefined ? {} : { priceMinor: price }),
          currency: "USD",
          availability,
          purchaseUrl: canonical,
        },
      ],
    };

    return {
      confidence: sku && availability !== "unknown" ? "high" : "medium",
      products: [product],
    };
  }
}
