import type { ProductEvent } from "../domain/event";

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export function eventEmail(event: ProductEvent): EmailContent {
  const retailer = retailerName(event.retailer);
  const title = eventTitle(event, retailer);
  const details: Array<[string, string]> = [
    ["Retailer", retailer],
    ["Product", event.productName],
  ];
  if (event.variantName && event.variantName !== event.productName) {
    details.push(["Variant", event.variantName]);
  }
  if (event.priceMinor !== undefined) {
    details.push(["Price", formatPrice(event.priceMinor, event.currency)]);
  }
  details.push(["Detected", formatTimestamp(event.detectedAt)]);
  const textDetails = details
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
  const htmlDetails = details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">${escapeHtml(label)}</td>` +
        `<td style="padding:4px 0;font-weight:600">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  return {
    subject: title,
    text: `${title}\n\n${textDetails}\n\nOpen product:\n${event.purchaseUrl}\n`,
    html:
      '<div style="max-width:620px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;color:#111827">' +
      `<h1 style="font-size:24px">${escapeHtml(title)}</h1>` +
      `<table style="border-collapse:collapse;font-size:15px">${htmlDetails}</table>` +
      `<p style="margin-top:24px"><a href="${escapeHtml(event.purchaseUrl)}" ` +
      'style="display:inline-block;background:#111827;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Open product</a></p>' +
      `<p style="font-size:12px;color:#9ca3af">Detected by SmudgeWatch.</p></div>`,
  };
}

function eventTitle(event: ProductEvent, retailer: string): string {
  switch (event.type) {
    case "restocked":
      return `Smudge Monkey restocked at ${retailer}`;
    case "product_discovered":
      return `New Smudge Monkey found at ${retailer}`;
    case "variant_discovered":
      return `New Smudge Monkey variant at ${retailer}`;
    case "price_changed":
      return `Smudge Monkey price changed at ${retailer}`;
    case "source_failed":
      return `SmudgeWatch cannot check ${retailer}`;
    case "source_recovered":
      return `SmudgeWatch recovered for ${retailer}`;
    case "sold_out":
      return `Smudge Monkey sold out at ${retailer}`;
  }
}

function retailerName(retailer: string): string {
  if (retailer === "jellycat-us") return "Jellycat US";
  if (retailer === "nordstrom-us") return "Nordstrom";
  return retailer;
}

function formatPrice(priceMinor: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    priceMinor / 100,
  );
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
