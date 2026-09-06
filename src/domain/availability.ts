export const AVAILABILITIES = [
  "available",
  "unavailable",
  "coming_soon",
  "retired",
  "unknown",
] as const;

export type Availability = (typeof AVAILABILITIES)[number];

export function availabilityFromSchema(value: unknown): Availability {
  if (typeof value !== "string") {
    return "unknown";
  }

  const normalized = value.toLowerCase();
  if (
    normalized.includes("instock") ||
    normalized.includes("limitedavailability")
  ) {
    return "available";
  }
  if (normalized.includes("outofstock") || normalized.includes("soldout")) {
    return "unavailable";
  }
  if (normalized.includes("preorder") || normalized.includes("presale")) {
    return "coming_soon";
  }
  if (normalized.includes("discontinued")) {
    return "retired";
  }
  return "unknown";
}

export function availabilityFromText(value: string): Availability {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();

  if (
    normalized.includes("retired") ||
    normalized.includes("discontinued") ||
    normalized.includes("no longer available")
  ) {
    return "retired";
  }
  if (normalized.includes("sold out") || normalized.includes("out of stock")) {
    return "unavailable";
  }
  if (
    normalized.includes("coming soon") ||
    normalized.includes("pre-order") ||
    normalized.includes("preorder")
  ) {
    return "coming_soon";
  }
  if (
    normalized.includes("add to bag") ||
    normalized.includes("add to cart") ||
    normalized.includes("in stock")
  ) {
    return "available";
  }
  return "unknown";
}
