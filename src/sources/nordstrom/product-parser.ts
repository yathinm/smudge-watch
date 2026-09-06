import { load } from "cheerio";

import type {
  ParseResult,
  ParsedVariant,
  SourceAdapter,
  SourceResponse,
} from "../../domain/product";
import { SourceParseError } from "../errors";
import {
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

export class NordstromProductAdapter implements SourceAdapter {
  parse(response: SourceResponse): ParseResult {
    assertUsableHtml(response.body);
    const $ = load(response.body);
    const main = $("main").first();
    const scope = main.length ? main : $("body").first();
    const pageText = scope.text().replace(/\s+/g, " ").trim();
    const structured = jsonLdRecords(response.body).find(
      (record) =>
        isProductRecord(record) &&
        asString(record["name"])?.toLowerCase().includes("smudge monkey"),
    );

    const structuredName = structured
      ? asString(structured["name"])
      : undefined;
    const name = structuredName ?? scope.find("h1").first().text().trim();
    if (!name.toLowerCase().includes("smudge monkey")) {
      throw new SourceParseError("Nordstrom product title was not found");
    }

    const itemNumber = pageText.match(/Item\s*#\s*([A-Z0-9]+)/i)?.[1];
    const coreProductId = pageText.match(/Core Product ID\s*([A-Z0-9]+)/i)?.[1];
    const externalId = coreProductId ?? itemNumber;
    const canonical = canonicalUrl(
      $('link[rel="canonical"]').attr("href") ??
        (structured ? asString(structured["url"]) : undefined) ??
        response.url,
      response.url,
    );
    let variants: ParsedVariant[] = structured
      ? variantsFromProductRecord(structured, canonical)
      : [];

    const visibleAvailability = productAvailability(pageText);
    if (variants.length === 0) {
      variants = [
        {
          key: normalizedKey(externalId ?? name),
          ...(externalId ? { externalId } : {}),
          name,
          ...(parsePriceMinor(
            scope
              .find('[itemprop="price"], [data-testid*="price"]')
              .first()
              .text(),
          ) === undefined
            ? {}
            : {
                priceMinor: parsePriceMinor(
                  scope
                    .find('[itemprop="price"], [data-testid*="price"]')
                    .first()
                    .text(),
                ),
              }),
          currency: "USD",
          availability: visibleAvailability,
          purchaseUrl: canonical,
        },
      ];
    } else if (visibleAvailability !== "unknown") {
      variants = variants.map((variant) => ({
        ...variant,
        availability:
          variant.availability === "unknown"
            ? visibleAvailability
            : variant.availability,
      }));
    }

    return {
      confidence:
        externalId &&
        variants.every((variant) => variant.availability !== "unknown")
          ? "high"
          : "medium",
      products: [
        {
          key: normalizedKey(new URL(canonical).pathname),
          ...(externalId ? { externalId } : {}),
          retailer: "nordstrom-us",
          name,
          canonicalUrl: canonical,
          variants,
        },
      ],
    };
  }
}
