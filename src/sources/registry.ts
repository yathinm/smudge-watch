import type { SourceAdapter, SourceDefinition } from "../domain/product";
import { JellycatCollectionAdapter } from "./jellycat/collection-parser";
import { JellycatProductAdapter } from "./jellycat/product-parser";
import { JellycatSitemapAdapter } from "./jellycat/sitemap-parser";
import { NordstromProductAdapter } from "./nordstrom/product-parser";

export const SOURCES: readonly SourceDefinition[] = [
  {
    id: "jellycat-smudge-monkey",
    retailer: "jellycat-us",
    kind: "product",
    name: "Jellycat Smudge Monkey",
    url: "https://us.jellycat.com/smudge-monkey/",
    pollIntervalSeconds: 60,
  },
  {
    id: "nordstrom-smudge-monkey",
    retailer: "nordstrom-us",
    kind: "product",
    name: "Nordstrom Smudge Monkey",
    url: "https://www.nordstrom.com/s/smudge-monkey-stuffed-animal/8213030",
    pollIntervalSeconds: 60,
  },
  {
    id: "jellycat-smudge-collection",
    retailer: "jellycat-us",
    kind: "collection",
    name: "Jellycat Smudge Collection",
    url: "https://us.jellycat.com/collections/super-soft-cuddly?page=2",
    pollIntervalSeconds: 300,
  },
  {
    id: "jellycat-sitemap",
    retailer: "jellycat-us",
    kind: "sitemap",
    name: "Jellycat Sitemap",
    url: "https://us.jellycat.com/xmlsitemap.php",
    pollIntervalSeconds: 3600,
  },
] as const;

const adapters: Record<string, SourceAdapter> = {
  "jellycat-smudge-monkey": new JellycatProductAdapter(),
  "nordstrom-smudge-monkey": new NordstromProductAdapter(),
  "jellycat-smudge-collection": new JellycatCollectionAdapter(),
  "jellycat-sitemap": new JellycatSitemapAdapter(),
};

export function adapterFor(sourceId: string): SourceAdapter {
  const adapter = adapters[sourceId];
  if (!adapter)
    throw new Error(`No adapter registered for source: ${sourceId}`);
  return adapter;
}
