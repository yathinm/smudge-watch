import type { Availability } from "./availability";

export type Retailer = "jellycat-us" | "nordstrom-us";
export type SourceKind = "product" | "collection" | "sitemap";

export interface SourceDefinition {
  id: string;
  retailer: Retailer;
  kind: SourceKind;
  name: string;
  url: string;
  pollIntervalSeconds: number;
}

export interface ParsedVariant {
  key: string;
  externalId?: string;
  sku?: string;
  name: string;
  size?: string;
  priceMinor?: number;
  currency?: string;
  availability: Availability;
  purchaseUrl: string;
}

export interface ParsedProduct {
  key: string;
  externalId?: string;
  retailer: Retailer;
  name: string;
  canonicalUrl: string;
  imageUrl?: string;
  variants: ParsedVariant[];
}

export type ParseConfidence = "high" | "medium" | "low";

export interface ParseResult {
  products: ParsedProduct[];
  confidence: ParseConfidence;
}

export interface SourceResponse {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export interface SourceAdapter {
  parse(response: SourceResponse): ParseResult;
}
