import type { EmailConfig } from "../config";
import type { ProductEvent } from "../domain/event";
import { deliverPendingEmails } from "../email/delivery";
import type {
  MonitorRepository,
  ObservationInput,
  StoredSource,
} from "../persistence/types";
import { SourceParseError } from "../sources/errors";
import { adapterFor, SOURCES } from "../sources/registry";
import { fetchSource, safeError, SourceFetchError } from "./fetcher";

const LEASE_TTL_MS = 45_000;

export interface MonitorStats {
  checked: number;
  succeeded: number;
  failed: number;
  events: number;
  emailsAccepted: number;
  emailsFailed: number;
}

export interface MonitorOptions {
  force?: boolean;
  now?: number;
  fetcher?: typeof fetch;
}

export async function runMonitor(
  repository: MonitorRepository,
  email: EmailConfig | undefined,
  options: MonitorOptions = {},
): Promise<MonitorStats> {
  const now = options.now ?? Date.now();
  const fetcher = options.fetcher ?? fetch;
  const runId = crypto.randomUUID();
  const stats: MonitorStats = {
    checked: 0,
    succeeded: 0,
    failed: 0,
    events: 0,
    emailsAccepted: 0,
    emailsFailed: 0,
  };

  await repository.ensureSources(SOURCES, now);
  await repository.startRun(runId, now);
  const dueSources = await repository.listDueSources(now, options.force);

  for (const source of dueSources) {
    const lease = await repository.acquireLease(source.id, now, LEASE_TTL_MS);
    if (!lease) continue;
    stats.checked += 1;
    try {
      const startedAt = Date.now();
      const fetched = await fetchSource(source, now, fetcher);
      if (fetched.notModified) {
        await repository.recordObservation(source.id, {
          checkedAt: now,
          succeeded: true,
          httpStatus: fetched.status,
          durationMs: Date.now() - startedAt,
        });
      } else {
        if (!fetched.response)
          throw new SourceParseError("fetch result did not include a response");
        const parsed = adapterForSource(source).parse(fetched.response);
        if (source.kind === "product" && parsed.products.length === 0) {
          throw new SourceParseError("product parser did not return a product");
        }
        if (parsed.confidence === "low" && source.kind === "product") {
          throw new SourceParseError("product parser confidence was too low");
        }
        await repository.recordObservation(source.id, {
          checkedAt: now,
          succeeded: true,
          httpStatus: fetched.status,
          contentHash: fetched.contentHash,
          confidence: parsed.confidence,
          durationMs: Date.now() - startedAt,
        });
        const events = await repository.applyProducts(
          source,
          parsed.products,
          now,
        );
        stats.events += events.length;
        if (source.kind !== "product") {
          for (const product of parsed.products) {
            await repository.ensureDiscoveredProductSource(product, now);
          }
        }
      }

      if (source.failureNotified) {
        if (
          await repository.createEvent(
            sourceEvent("source_recovered", source, now),
          )
        ) {
          stats.events += 1;
        }
      }
      await repository.recordSourceSuccess(source, {
        now,
        status: fetched.status,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
      });
      stats.succeeded += 1;
    } catch (error) {
      const observation = failureObservation(error, now);
      await repository.recordObservation(source.id, observation);
      const result = await repository.recordSourceFailure(
        source,
        observation,
        error instanceof SourceFetchError ? error.retryAt : undefined,
      );
      if (result.shouldNotify) {
        if (
          await repository.createEvent(
            sourceEvent("source_failed", source, now),
          )
        ) {
          stats.events += 1;
        }
      }
      stats.failed += 1;
      console.error(
        JSON.stringify({
          level: "error",
          sourceId: source.id,
          code: observation.errorCode,
          message: observation.errorMessage,
        }),
      );
    } finally {
      await repository.releaseLease(source.id, lease);
    }
  }

  const emailStats = await deliverPendingEmails(
    repository,
    email,
    now,
    fetcher,
  );
  stats.emailsAccepted = emailStats.accepted;
  stats.emailsFailed = emailStats.failed;
  await repository.finishRun(runId, Date.now(), stats);
  return stats;
}

function adapterForSource(source: StoredSource) {
  if (source.id.startsWith("jellycat-product-"))
    return adapterFor("jellycat-smudge-monkey");
  return adapterFor(source.id);
}

function failureObservation(error: unknown, now: number): ObservationInput {
  return {
    checkedAt: now,
    succeeded: false,
    ...(error instanceof SourceFetchError && error.status !== undefined
      ? { httpStatus: error.status }
      : {}),
    durationMs: 0,
    errorCode:
      error instanceof SourceFetchError
        ? error.code
        : error instanceof SourceParseError
          ? error.name
          : "unknown_error",
    errorMessage: safeError(error),
  };
}

function sourceEvent(
  type: "source_failed" | "source_recovered",
  source: StoredSource,
  now: number,
): ProductEvent {
  return {
    type,
    sourceId: source.id,
    retailer: source.retailer,
    productKey: "source-health",
    productName: source.name,
    purchaseUrl: source.url,
    detectedAt: now,
  };
}
