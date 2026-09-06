import type { SourceResponse } from "../domain/product";
import type { StoredSource } from "../persistence/types";

const ALLOWED_HOSTS = new Set(["us.jellycat.com", "www.nordstrom.com"]);
const MAX_RESPONSE_BYTES = 3_000_000;
const REQUEST_TIMEOUT_MS = 20_000;

export class SourceFetchError extends Error {
  override readonly name = "SourceFetchError";

  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly retryAt?: number,
  ) {
    super(message);
  }
}

export interface FetchResult {
  response?: SourceResponse;
  notModified: boolean;
  status: number;
  etag?: string;
  lastModified?: string;
  contentHash?: string;
}

export async function fetchSource(
  source: StoredSource,
  now: number,
  fetcher: typeof fetch = fetch,
  browser?: BrowserRun,
): Promise<FetchResult> {
  const url = validateSourceUrl(source.url);

  const headers = new Headers({
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.8",
    "User-Agent": "SmudgeWatch/1.0 (+https://github.com/yathinm/smudge-watch)",
  });
  if (source.etag) headers.set("If-None-Match", source.etag);
  if (source.lastModified)
    headers.set("If-Modified-Since", source.lastModified);

  let result: Response;
  try {
    result = await fetcher(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SourceFetchError(safeError(error), "network_error");
  }

  if (result.status === 304) {
    return {
      notModified: true,
      status: 304,
      ...responseValidators(result),
    };
  }
  if (!result.ok) {
    if (result.status === 403 && browser) {
      return fetchRenderedSource(source, browser);
    }
    const retryAt = parseRetryAfter(result.headers.get("Retry-After"), now);
    throw new SourceFetchError(
      `source returned HTTP ${result.status}`,
      `http_${result.status}`,
      result.status,
      retryAt,
    );
  }

  const contentLength = Number.parseInt(
    result.headers.get("Content-Length") ?? "0",
    10,
  );
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new SourceFetchError(
      "source response exceeds size limit",
      "response_too_large",
      result.status,
    );
  }

  const contentType = result.headers.get("Content-Type") ?? "";
  if (!/(html|xml|text\/plain)/i.test(contentType)) {
    throw new SourceFetchError(
      `unsupported source content type: ${contentType || "missing"}`,
      "invalid_content_type",
      result.status,
    );
  }
  const body = await result.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new SourceFetchError(
      "source response exceeds size limit",
      "response_too_large",
      result.status,
    );
  }

  return {
    response: {
      url: result.url || source.url,
      status: result.status,
      contentType,
      body,
    },
    notModified: false,
    status: result.status,
    ...responseValidators(result),
    contentHash: await sha256(body),
  };
}

interface BrowserContentResponse {
  success: boolean;
  result?: string;
  meta?: {
    status?: number;
    finalUrl?: string;
    headers?: Record<string, string>;
  };
  errors?: Array<{ message?: string }>;
}

export async function fetchRenderedSource(
  source: StoredSource,
  browser: BrowserRun,
): Promise<FetchResult> {
  validateSourceUrl(source.url);

  let result: Response;
  try {
    result = await browser.quickAction("content", {
      url: source.url,
      gotoOptions: {
        timeout: REQUEST_TIMEOUT_MS,
        waitUntil: "domcontentloaded",
      },
      waitForSelector: {
        selector: source.kind === "sitemap" ? "body" : "h1",
        timeout: REQUEST_TIMEOUT_MS,
      },
      waitForTimeout: 750,
      rejectResourceTypes: ["image", "media", "font"],
      cacheTTL: 0,
      bestAttempt: true,
    });
  } catch (error) {
    throw new SourceFetchError(safeError(error), "browser_network_error");
  }

  let payload: BrowserContentResponse;
  try {
    payload = (await result.json()) as BrowserContentResponse;
  } catch {
    throw new SourceFetchError(
      "browser renderer returned an invalid response",
      "browser_invalid_response",
      result.status,
    );
  }

  if (!result.ok || !payload.success || typeof payload.result !== "string") {
    const detail = payload.errors?.[0]?.message?.slice(0, 300);
    throw new SourceFetchError(
      detail ? `browser renderer failed: ${detail}` : "browser renderer failed",
      `browser_http_${result.status}`,
      result.status,
    );
  }

  const status = payload.meta?.status ?? 200;
  if (status < 200 || status >= 300) {
    throw new SourceFetchError(
      `rendered source returned HTTP ${status}`,
      `http_${status}`,
      status,
    );
  }
  const body = payload.result;
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new SourceFetchError(
      "rendered source response exceeds size limit",
      "response_too_large",
      status,
    );
  }

  const headers = new Headers(payload.meta?.headers);
  const contentType = headers.get("Content-Type") ?? "text/html";
  return {
    response: {
      url: payload.meta?.finalUrl ?? source.url,
      status,
      contentType,
      body,
    },
    notModified: false,
    status,
    contentHash: await sha256(body),
  };
}

function validateSourceUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new SourceFetchError(
      "source URL is not allowlisted",
      "invalid_source_url",
    );
  }
  return url;
}

function responseValidators(response: Response): {
  etag?: string;
  lastModified?: string;
} {
  const etag = response.headers.get("ETag")?.trim();
  const lastModified = response.headers.get("Last-Modified")?.trim();
  return {
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {}),
  };
}

function parseRetryAfter(
  value: string | null,
  now: number,
): number | undefined {
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : undefined;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "unknown error";
}
