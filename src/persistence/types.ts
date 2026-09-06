import type {
  ParseConfidence,
  ParsedProduct,
  SourceDefinition,
} from "../domain/product";
import type { ProductEvent } from "../domain/event";

export interface StoredSource extends SourceDefinition {
  nextPollAt: number;
  lastSuccessAt?: number;
  lastAttemptAt?: number;
  baselineCompletedAt?: number;
  consecutiveFailures: number;
  failureNotified: boolean;
  etag?: string;
  lastModified?: string;
  lastHttpStatus?: number;
  lastError?: string;
  enabled: boolean;
}

export interface ObservationInput {
  checkedAt: number;
  succeeded: boolean;
  httpStatus?: number;
  contentHash?: string;
  confidence?: ParseConfidence;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface SourceSuccessInput {
  now: number;
  status: number;
  etag?: string;
  lastModified?: string;
}

export interface SourceFailureResult {
  consecutiveFailures: number;
  shouldNotify: boolean;
}

export interface EmailDelivery {
  eventFingerprint: string;
  event: ProductEvent;
  attemptCount: number;
}

export interface StatusVariant {
  retailer: string;
  productName: string;
  variantName: string;
  sku?: string;
  priceMinor?: number;
  currency?: string;
  availability: string;
  purchaseUrl: string;
  lastSeenAt: number;
}

export interface EventRecord {
  fingerprint: string;
  event: ProductEvent;
  createdAt: number;
  deliveryStatus?: string;
}

export interface MonitorRepository {
  ensureSources(
    sources: readonly SourceDefinition[],
    now: number,
  ): Promise<void>;
  ensureDiscoveredProductSource(
    product: ParsedProduct,
    now: number,
  ): Promise<void>;
  listDueSources(now: number, force?: boolean): Promise<StoredSource[]>;
  acquireLease(
    sourceId: string,
    now: number,
    ttlMs: number,
  ): Promise<string | undefined>;
  releaseLease(sourceId: string, token: string): Promise<void>;
  recordObservation(sourceId: string, input: ObservationInput): Promise<void>;
  recordSourceSuccess(
    source: StoredSource,
    input: SourceSuccessInput,
  ): Promise<void>;
  recordSourceFailure(
    source: StoredSource,
    observation: ObservationInput,
    retryAt?: number,
  ): Promise<SourceFailureResult>;
  applyProducts(
    source: StoredSource,
    products: ParsedProduct[],
    now: number,
  ): Promise<ProductEvent[]>;
  createEvent(event: ProductEvent): Promise<boolean>;
  listPendingDeliveries(now: number, limit: number): Promise<EmailDelivery[]>;
  markDeliveryAccepted(
    fingerprint: string,
    messageId: string,
    now: number,
  ): Promise<void>;
  markDeliveryFailed(
    fingerprint: string,
    error: string,
    nextAttemptAt: number | undefined,
    now: number,
  ): Promise<void>;
  startRun(runId: string, now: number): Promise<void>;
  finishRun(
    runId: string,
    now: number,
    stats: {
      checked: number;
      succeeded: number;
      failed: number;
      events: number;
    },
  ): Promise<void>;
  listStatus(): Promise<StatusVariant[]>;
  listEvents(limit: number): Promise<EventRecord[]>;
  getHealth(): Promise<{ sources: StoredSource[]; lastRunAt?: number }>;
  cleanup(before: number): Promise<void>;
}
