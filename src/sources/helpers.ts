import { load } from "cheerio";

import type { AnyNode } from "domhandler";
import type { Availability } from "../domain/availability";
import {
  availabilityFromSchema,
  availabilityFromText,
} from "../domain/availability";
import type { ParsedVariant } from "../domain/product";
import { ChallengePageError, SourceParseError } from "./errors";

type JsonRecord = Record<string, unknown>;

export function assertUsableHtml(body: string): void {
  const normalized = body.toLowerCase();
  if (
    normalized.includes("cf-chl-") ||
    normalized.includes("challenge-platform") ||
    normalized.includes("cf-mitigated") ||
    normalized.includes("just a moment...") ||
    normalized.includes("captcha")
  ) {
    throw new ChallengePageError("source returned an access challenge");
  }
  if (body.trim().length < 100) {
    throw new SourceParseError(
      "source returned an unexpectedly small document",
    );
  }
}

export function jsonLdRecords(html: string): JsonRecord[] {
  const $ = load(html);
  const records: JsonRecord[] = [];

  $('script[type="application/ld+json"]').each(
    (_index: number, node: AnyNode) => {
      const value = $(node).text().trim();
      if (!value) return;
      try {
        flattenJsonLd(JSON.parse(value) as unknown, records);
      } catch {
        // A page can contain unrelated malformed analytics JSON-LD. The caller
        // will still validate that a real product was extracted.
      }
    },
  );
  return records;
}

function flattenJsonLd(value: unknown, output: JsonRecord[]): void {
  if (Array.isArray(value)) {
    for (const child of value) flattenJsonLd(child, output);
    return;
  }
  if (!isRecord(value)) return;

  output.push(value);
  if (Array.isArray(value["@graph"])) {
    flattenJsonLd(value["@graph"], output);
  }
}

export function isProductRecord(record: JsonRecord): boolean {
  const type = record["@type"];
  return (
    type === "Product" || (Array.isArray(type) && type.includes("Product"))
  );
}

export function variantsFromProductRecord(
  record: JsonRecord,
  fallbackUrl: string,
): ParsedVariant[] {
  const name = asString(record["name"]) ?? "Smudge Monkey";
  const sku = asString(record["sku"]);
  const offers = toRecords(record["offers"]);

  if (offers.length === 0) {
    return [
      {
        key: normalizedKey(sku ?? name),
        ...(sku ? { sku } : {}),
        name,
        availability: "unknown",
        purchaseUrl: asString(record["url"]) ?? fallbackUrl,
      },
    ];
  }

  return offers.map((offer, index) => {
    const offerSku = asString(offer["sku"]) ?? sku;
    const offerName = asString(offer["name"]) ?? name;
    const price = parsePriceMinor(offer["price"] ?? offer["lowPrice"]);
    const currency = asString(offer["priceCurrency"]);
    const url =
      asString(offer["url"]) ?? asString(record["url"]) ?? fallbackUrl;
    const availability = availabilityFromSchema(offer["availability"]);

    return {
      key: normalizedKey(offerSku ?? `${offerName}-${index}`),
      ...(offerSku ? { sku: offerSku, externalId: offerSku } : {}),
      name: offerName,
      ...(price === undefined ? {} : { priceMinor: price }),
      ...(currency ? { currency } : {}),
      availability,
      purchaseUrl: absoluteUrl(url, fallbackUrl),
    };
  });
}

export function parsePriceMinor(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value !== "string") return undefined;
  const match = value.replaceAll(",", "").match(/(\d+(?:\.\d{1,2})?)/);
  if (!match?.[1]) return undefined;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : undefined;
}

export function productAvailability(text: string): Availability {
  return availabilityFromText(text);
}

export function normalizedKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function canonicalUrl(value: string, fallback: string): string {
  const url = new URL(value, fallback);
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

export function absoluteUrl(value: string, fallback: string): string {
  return new URL(value, fallback).toString();
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecords(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}
