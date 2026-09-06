import type { ProductEvent } from "../domain/event";
import { eventFingerprint } from "../domain/event";
import type {
  ParsedProduct,
  ParsedVariant,
  SourceDefinition,
} from "../domain/product";
import { normalizedKey } from "../sources/helpers";
import type {
  EmailDelivery,
  EventRecord,
  MonitorRepository,
  ObservationInput,
  SourceFailureResult,
  SourceSuccessInput,
  StatusVariant,
  StoredSource,
} from "./types";

interface SourceRow {
  id: string;
  retailer: string;
  kind: string;
  name: string;
  url: string;
  poll_interval_seconds: number;
  next_poll_at: number;
  last_success_at: number | null;
  last_attempt_at: number | null;
  baseline_completed_at: number | null;
  consecutive_failures: number;
  failure_notified: number;
  etag: string | null;
  last_modified: string | null;
  last_http_status: number | null;
  last_error: string | null;
  enabled: number;
}

interface ProductRow {
  id: number;
  retailer: string;
  product_key: string;
  external_id: string | null;
  name: string;
  canonical_url: string;
}

interface VariantRow {
  id: number;
  variant_key: string;
  availability: ParsedVariant["availability"];
  price_minor: number | null;
  currency: string | null;
}

const NOTIFIABLE_EVENTS = new Set([
  "product_discovered",
  "variant_discovered",
  "restocked",
  "price_changed",
  "source_failed",
  "source_recovered",
]);

export class D1MonitorRepository implements MonitorRepository {
  constructor(private readonly db: D1Database) {}

  async ensureSources(
    sources: readonly SourceDefinition[],
    now: number,
  ): Promise<void> {
    if (sources.length === 0) return;
    await this.db.batch(
      sources.map((source) =>
        this.db
          .prepare(
            `INSERT INTO sources (
              id, retailer, kind, name, url, poll_interval_seconds,
              next_poll_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              retailer = excluded.retailer,
              kind = excluded.kind,
              name = excluded.name,
              url = excluded.url,
              poll_interval_seconds = excluded.poll_interval_seconds,
              updated_at = excluded.updated_at`,
          )
          .bind(
            source.id,
            source.retailer,
            source.kind,
            source.name,
            source.url,
            source.pollIntervalSeconds,
            now,
            now,
          ),
      ),
    );
  }

  async ensureDiscoveredProductSource(
    product: ParsedProduct,
    now: number,
  ): Promise<void> {
    if (product.retailer !== "jellycat-us") return;
    const existing = await this.db
      .prepare("SELECT id FROM sources WHERE url = ?")
      .bind(product.canonicalUrl)
      .first<{ id: string }>();
    if (existing) return;
    const id = `jellycat-product-${normalizedKey(new URL(product.canonicalUrl).pathname)}`;
    await this.ensureSources(
      [
        {
          id,
          retailer: "jellycat-us",
          kind: "product",
          name: product.name,
          url: product.canonicalUrl,
          pollIntervalSeconds: 60,
        },
      ],
      now,
    );
  }

  async listDueSources(now: number, force = false): Promise<StoredSource[]> {
    const query = force
      ? "SELECT * FROM sources WHERE enabled = 1 ORDER BY kind, id"
      : "SELECT * FROM sources WHERE enabled = 1 AND next_poll_at <= ? ORDER BY kind, id";
    const result = force
      ? await this.db.prepare(query).all<SourceRow>()
      : await this.db.prepare(query).bind(now).all<SourceRow>();
    return result.results.map(toStoredSource);
  }

  async acquireLease(
    sourceId: string,
    now: number,
    ttlMs: number,
  ): Promise<string | undefined> {
    const token = crypto.randomUUID();
    const result = await this.db
      .prepare(
        `INSERT INTO leases (source_id, token, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(source_id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
         WHERE leases.expires_at <= ?`,
      )
      .bind(sourceId, token, now + ttlMs, now)
      .run();
    return result.meta.changes > 0 ? token : undefined;
  }

  async releaseLease(sourceId: string, token: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM leases WHERE source_id = ? AND token = ?")
      .bind(sourceId, token)
      .run();
  }

  async recordObservation(
    sourceId: string,
    input: ObservationInput,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO observations (
          source_id, checked_at, succeeded, http_status, content_hash,
          parser_confidence, duration_ms, error_code, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        sourceId,
        input.checkedAt,
        input.succeeded ? 1 : 0,
        input.httpStatus ?? null,
        input.contentHash ?? null,
        input.confidence ?? null,
        input.durationMs,
        input.errorCode ?? null,
        input.errorMessage ?? null,
      )
      .run();
  }

  async recordSourceSuccess(
    source: StoredSource,
    input: SourceSuccessInput,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE sources SET
          next_poll_at = ?, last_success_at = ?, last_attempt_at = ?,
          baseline_completed_at = COALESCE(baseline_completed_at, ?),
          consecutive_failures = 0, failure_notified = 0,
          etag = ?, last_modified = ?, last_http_status = ?, last_error = NULL,
          updated_at = ?
        WHERE id = ?`,
      )
      .bind(
        input.now + source.pollIntervalSeconds * 1000,
        input.now,
        input.now,
        input.now,
        input.etag ?? null,
        input.lastModified ?? null,
        input.status,
        input.now,
        source.id,
      )
      .run();
  }

  async recordSourceFailure(
    source: StoredSource,
    observation: ObservationInput,
    retryAt?: number,
  ): Promise<SourceFailureResult> {
    const failures = source.consecutiveFailures + 1;
    const shouldNotify = failures >= 3 && !source.failureNotified;
    const exponentialDelay = Math.min(
      source.pollIntervalSeconds * 1000 * 2 ** Math.max(0, failures - 2),
      60 * 60 * 1000,
    );
    const nextPollAt = Math.max(
      observation.checkedAt + exponentialDelay,
      retryAt ?? observation.checkedAt,
    );
    await this.db
      .prepare(
        `UPDATE sources SET next_poll_at = ?, last_attempt_at = ?,
          consecutive_failures = ?, failure_notified = ?, last_http_status = ?,
          last_error = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(
        nextPollAt,
        observation.checkedAt,
        failures,
        shouldNotify || source.failureNotified ? 1 : 0,
        observation.httpStatus ?? null,
        observation.errorMessage ?? "unknown source failure",
        observation.checkedAt,
        source.id,
      )
      .run();
    return { consecutiveFailures: failures, shouldNotify };
  }

  async applyProducts(
    source: StoredSource,
    products: ParsedProduct[],
    now: number,
  ): Promise<ProductEvent[]> {
    const events: ProductEvent[] = [];
    const emitChanges = source.baselineCompletedAt !== undefined;

    for (const product of products) {
      const existingProduct = await this.db
        .prepare(
          "SELECT * FROM products WHERE retailer = ? AND product_key = ?",
        )
        .bind(product.retailer, product.key)
        .first<ProductRow>();

      await this.db
        .prepare(
          `INSERT INTO products (
            retailer, product_key, external_id, name, canonical_url, image_url,
            first_seen_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(retailer, product_key) DO UPDATE SET
            external_id = COALESCE(excluded.external_id, products.external_id),
            name = excluded.name, canonical_url = excluded.canonical_url,
            image_url = COALESCE(excluded.image_url, products.image_url),
            last_seen_at = excluded.last_seen_at`,
        )
        .bind(
          product.retailer,
          product.key,
          product.externalId ?? null,
          product.name,
          product.canonicalUrl,
          product.imageUrl ?? null,
          now,
          now,
        )
        .run();

      const storedProduct = await this.db
        .prepare(
          "SELECT * FROM products WHERE retailer = ? AND product_key = ?",
        )
        .bind(product.retailer, product.key)
        .first<ProductRow>();
      if (!storedProduct)
        throw new Error("product upsert did not return a stored product");

      if (!existingProduct && emitChanges && source.kind !== "product") {
        events.push({
          type: "product_discovered",
          sourceId: source.id,
          retailer: product.retailer,
          productKey: product.key,
          productName: product.name,
          availability: product.variants[0]?.availability,
          priceMinor: product.variants[0]?.priceMinor,
          currency: product.variants[0]?.currency,
          purchaseUrl: product.canonicalUrl,
          detectedAt: now,
        });
      }

      for (const variant of product.variants) {
        const previous = await this.db
          .prepare(
            "SELECT * FROM variants WHERE product_id = ? AND variant_key = ?",
          )
          .bind(storedProduct.id, variant.key)
          .first<VariantRow>();

        await this.upsertVariant(storedProduct.id, variant, now);
        if (!emitChanges || source.kind !== "product") continue;

        if (!previous) {
          events.push(
            this.variantEvent(
              "variant_discovered",
              source,
              product,
              variant,
              now,
            ),
          );
          continue;
        }
        if (
          variant.availability === "available" &&
          previous.availability !== "available" &&
          previous.availability !== "unknown"
        ) {
          events.push(
            this.variantEvent("restocked", source, product, variant, now, {
              previousAvailability: previous.availability,
            }),
          );
        } else if (
          previous.availability === "available" &&
          ["unavailable", "retired"].includes(variant.availability)
        ) {
          events.push(
            this.variantEvent("sold_out", source, product, variant, now, {
              previousAvailability: previous.availability,
            }),
          );
        }
        if (
          previous.price_minor !== null &&
          variant.priceMinor !== undefined &&
          previous.price_minor !== variant.priceMinor
        ) {
          events.push(
            this.variantEvent("price_changed", source, product, variant, now, {
              previousPriceMinor: previous.price_minor,
            }),
          );
        }
      }
    }

    const created: ProductEvent[] = [];
    for (const event of events) {
      if (await this.createEvent(event)) created.push(event);
    }
    return created;
  }

  async createEvent(event: ProductEvent): Promise<boolean> {
    const fingerprint = eventFingerprint(event);
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO events (
          fingerprint, event_type, source_id, retailer, product_key,
          variant_key, payload, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        fingerprint,
        event.type,
        event.sourceId,
        event.retailer,
        event.productKey,
        event.variantKey ?? null,
        JSON.stringify(event),
        event.detectedAt,
      )
      .run();
    if (result.meta.changes === 0) return false;

    const shouldNotify =
      NOTIFIABLE_EVENTS.has(event.type) &&
      (event.type !== "variant_discovered" ||
        event.availability === "available");
    if (shouldNotify) {
      await this.db
        .prepare(
          `INSERT OR IGNORE INTO email_deliveries (
            event_fingerprint, status, next_attempt_at, updated_at
          ) VALUES (?, 'pending', ?, ?)`,
        )
        .bind(fingerprint, event.detectedAt, event.detectedAt)
        .run();
    }
    return true;
  }

  async listPendingDeliveries(
    now: number,
    limit: number,
  ): Promise<EmailDelivery[]> {
    const result = await this.db
      .prepare(
        `SELECT d.event_fingerprint, d.attempt_count, e.payload
         FROM email_deliveries d JOIN events e ON e.fingerprint = d.event_fingerprint
         WHERE d.status IN ('pending', 'retrying') AND d.next_attempt_at <= ?
         ORDER BY d.next_attempt_at LIMIT ?`,
      )
      .bind(now, limit)
      .all<{
        event_fingerprint: string;
        attempt_count: number;
        payload: string;
      }>();
    return result.results.map((row) => ({
      eventFingerprint: row.event_fingerprint,
      event: JSON.parse(row.payload) as ProductEvent,
      attemptCount: row.attempt_count,
    }));
  }

  async markDeliveryAccepted(
    fingerprint: string,
    messageId: string,
    now: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE email_deliveries SET status = 'accepted', attempt_count = attempt_count + 1,
         provider_message_id = ?, accepted_at = ?, last_error = NULL, updated_at = ?
         WHERE event_fingerprint = ?`,
      )
      .bind(messageId, now, now, fingerprint)
      .run();
  }

  async markDeliveryFailed(
    fingerprint: string,
    error: string,
    nextAttemptAt: number | undefined,
    now: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE email_deliveries SET status = ?, attempt_count = attempt_count + 1,
         next_attempt_at = ?, last_error = ?, updated_at = ? WHERE event_fingerprint = ?`,
      )
      .bind(
        nextAttemptAt === undefined ? "failed" : "retrying",
        nextAttemptAt ?? now,
        error,
        now,
        fingerprint,
      )
      .run();
  }

  async startRun(runId: string, now: number): Promise<void> {
    await this.db
      .prepare("INSERT INTO monitor_runs (id, started_at) VALUES (?, ?)")
      .bind(runId, now)
      .run();
  }

  async finishRun(
    runId: string,
    now: number,
    stats: {
      checked: number;
      succeeded: number;
      failed: number;
      events: number;
    },
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE monitor_runs SET finished_at = ?, sources_checked = ?,
         sources_succeeded = ?, sources_failed = ?, events_created = ? WHERE id = ?`,
      )
      .bind(
        now,
        stats.checked,
        stats.succeeded,
        stats.failed,
        stats.events,
        runId,
      )
      .run();
  }

  async listStatus(): Promise<StatusVariant[]> {
    const result = await this.db
      .prepare(
        `SELECT p.retailer, p.name AS product_name, v.name AS variant_name,
          v.sku, v.price_minor, v.currency, v.availability, v.purchase_url, v.last_seen_at
         FROM variants v JOIN products p ON p.id = v.product_id
         WHERE v.variant_key != 'listing'
         ORDER BY p.retailer, p.name, v.name`,
      )
      .all<{
        retailer: string;
        product_name: string;
        variant_name: string;
        sku: string | null;
        price_minor: number | null;
        currency: string | null;
        availability: string;
        purchase_url: string;
        last_seen_at: number;
      }>();
    return result.results.map((row) => ({
      retailer: row.retailer,
      productName: row.product_name,
      variantName: row.variant_name,
      ...(row.sku ? { sku: row.sku } : {}),
      ...(row.price_minor === null ? {} : { priceMinor: row.price_minor }),
      ...(row.currency ? { currency: row.currency } : {}),
      availability: row.availability,
      purchaseUrl: row.purchase_url,
      lastSeenAt: row.last_seen_at,
    }));
  }

  async listEvents(limit: number): Promise<EventRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT e.fingerprint, e.payload, e.created_at, d.status AS delivery_status
         FROM events e LEFT JOIN email_deliveries d ON d.event_fingerprint = e.fingerprint
         ORDER BY e.created_at DESC LIMIT ?`,
      )
      .bind(limit)
      .all<{
        fingerprint: string;
        payload: string;
        created_at: number;
        delivery_status: string | null;
      }>();
    return result.results.map((row) => ({
      fingerprint: row.fingerprint,
      event: JSON.parse(row.payload) as ProductEvent,
      createdAt: row.created_at,
      ...(row.delivery_status ? { deliveryStatus: row.delivery_status } : {}),
    }));
  }

  async getHealth(): Promise<{ sources: StoredSource[]; lastRunAt?: number }> {
    const sources = await this.db
      .prepare("SELECT * FROM sources ORDER BY id")
      .all<SourceRow>();
    const lastRun = await this.db
      .prepare(
        "SELECT finished_at FROM monitor_runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1",
      )
      .first<{ finished_at: number }>();
    return {
      sources: sources.results.map(toStoredSource),
      ...(lastRun ? { lastRunAt: lastRun.finished_at } : {}),
    };
  }

  async cleanup(before: number): Promise<void> {
    await this.db.batch([
      this.db
        .prepare("DELETE FROM observations WHERE checked_at < ?")
        .bind(before),
      this.db
        .prepare("DELETE FROM monitor_runs WHERE started_at < ?")
        .bind(before),
      this.db
        .prepare("DELETE FROM leases WHERE expires_at < ?")
        .bind(Date.now()),
    ]);
  }

  private async upsertVariant(
    productId: number,
    variant: ParsedVariant,
    now: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO variants (
          product_id, variant_key, external_id, sku, name, size, price_minor,
          currency, availability, purchase_url, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(product_id, variant_key) DO UPDATE SET
          external_id = COALESCE(excluded.external_id, variants.external_id),
          sku = COALESCE(excluded.sku, variants.sku), name = excluded.name,
          size = COALESCE(excluded.size, variants.size),
          price_minor = COALESCE(excluded.price_minor, variants.price_minor),
          currency = COALESCE(excluded.currency, variants.currency),
          availability = CASE WHEN excluded.availability = 'unknown'
            THEN variants.availability ELSE excluded.availability END,
          purchase_url = excluded.purchase_url, last_seen_at = excluded.last_seen_at`,
      )
      .bind(
        productId,
        variant.key,
        variant.externalId ?? null,
        variant.sku ?? null,
        variant.name,
        variant.size ?? null,
        variant.priceMinor ?? null,
        variant.currency ?? null,
        variant.availability,
        variant.purchaseUrl,
        now,
        now,
      )
      .run();
  }

  private variantEvent(
    type: ProductEvent["type"],
    source: StoredSource,
    product: ParsedProduct,
    variant: ParsedVariant,
    now: number,
    previous: Pick<
      ProductEvent,
      "previousAvailability" | "previousPriceMinor"
    > = {},
  ): ProductEvent {
    return {
      type,
      sourceId: source.id,
      retailer: product.retailer,
      productKey: product.key,
      variantKey: variant.key,
      productName: product.name,
      variantName: variant.name,
      ...previous,
      availability: variant.availability,
      priceMinor: variant.priceMinor,
      currency: variant.currency,
      purchaseUrl: variant.purchaseUrl,
      detectedAt: now,
    };
  }
}

function toStoredSource(row: SourceRow): StoredSource {
  return {
    id: row.id,
    retailer: row.retailer as StoredSource["retailer"],
    kind: row.kind as StoredSource["kind"],
    name: row.name,
    url: row.url,
    pollIntervalSeconds: row.poll_interval_seconds,
    nextPollAt: row.next_poll_at,
    ...(row.last_success_at === null
      ? {}
      : { lastSuccessAt: row.last_success_at }),
    ...(row.last_attempt_at === null
      ? {}
      : { lastAttemptAt: row.last_attempt_at }),
    ...(row.baseline_completed_at === null
      ? {}
      : { baselineCompletedAt: row.baseline_completed_at }),
    consecutiveFailures: row.consecutive_failures,
    failureNotified: row.failure_notified === 1,
    ...(row.etag ? { etag: row.etag } : {}),
    ...(row.last_modified ? { lastModified: row.last_modified } : {}),
    ...(row.last_http_status === null
      ? {}
      : { lastHttpStatus: row.last_http_status }),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    enabled: row.enabled === 1,
  };
}
