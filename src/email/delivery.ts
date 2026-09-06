import type { EmailConfig } from "../config";
import type { MonitorRepository } from "../persistence/types";
import { EmailSendError, sendWithResend } from "./resend-client";
import { eventEmail } from "./templates";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;

export async function deliverPendingEmails(
  repository: MonitorRepository,
  config: EmailConfig | undefined,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<{ accepted: number; failed: number }> {
  if (!config) return { accepted: 0, failed: 0 };
  const deliveries = await repository.listPendingDeliveries(now, 10);
  let accepted = 0;
  let failed = 0;

  for (const delivery of deliveries) {
    try {
      const messageId = await sendWithResend(
        config,
        eventEmail(delivery.event),
        delivery.eventFingerprint,
        fetcher,
      );
      await repository.markDeliveryAccepted(
        delivery.eventFingerprint,
        messageId,
        now,
      );
      accepted += 1;
    } catch (error) {
      const permanent = error instanceof EmailSendError && error.permanent;
      const delay = RETRY_DELAYS_MS[delivery.attemptCount];
      const nextAttemptAt =
        permanent || delay === undefined ? undefined : now + delay;
      const message =
        error instanceof Error
          ? error.message.slice(0, 500)
          : "unknown email error";
      await repository.markDeliveryFailed(
        delivery.eventFingerprint,
        message,
        nextAttemptAt,
        now,
      );
      failed += 1;
    }
  }
  return { accepted, failed };
}
