import type { SourceAdapter, SourceDefinition } from "../domain/product";
import { JellycatProductAdapter } from "./jellycat/product-parser";
import { NordstromProductAdapter } from "./nordstrom/product-parser";

export const SOURCES: readonly SourceDefinition[] = [
  {
    id: "nordstrom-smudge-monkey",
    retailer: "nordstrom-us",
    kind: "product",
    name: "Nordstrom Smudge Monkey",
    url: "https://www.nordstrom.com/s/smudge-monkey-stuffed-animal/8213030",
    pollIntervalSeconds: 900,
  },
] as const;

const adapters: Record<string, SourceAdapter> = {
  "jellycat-smudge-monkey": new JellycatProductAdapter(),
  "nordstrom-smudge-monkey": new NordstromProductAdapter(),
};

export function adapterFor(sourceId: string): SourceAdapter {
  const adapter = adapters[sourceId];
  if (!adapter)
    throw new Error(`No adapter registered for source: ${sourceId}`);
  return adapter;
}
