import type {
  ParseResult,
  ParsedProduct,
  SourceAdapter,
  SourceResponse,
} from "../../domain/product";
import { assertUsableHtml, canonicalUrl, normalizedKey } from "../helpers";

export class JellycatSitemapAdapter implements SourceAdapter {
  parse(response: SourceResponse): ParseResult {
    assertUsableHtml(response.body);
    const products: ParsedProduct[] = [];
    const seen = new Set<string>();
    const locations = response.body.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi);

    for (const match of locations) {
      const rawUrl = decodeXml(match[1] ?? "");
      if (!rawUrl.toLowerCase().includes("smudge-monkey")) continue;
      const url = canonicalUrl(rawUrl, response.url);
      const key = normalizedKey(new URL(url).pathname);
      if (seen.has(key)) continue;
      seen.add(key);
      products.push({
        key,
        retailer: "jellycat-us",
        name: titleFromUrl(url),
        canonicalUrl: url,
        variants: [
          {
            key: "listing",
            name: titleFromUrl(url),
            availability: "unknown",
            purchaseUrl: url,
          },
        ],
      });
    }

    return {
      confidence: products.length > 0 ? "medium" : "low",
      products,
    };
  }
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function titleFromUrl(value: string): string {
  const parts = new URL(value).pathname.split("/").filter(Boolean);
  const slug = parts.at(-1) ?? "smudge-monkey";
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
