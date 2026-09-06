import type { EmailConfig } from "../config";
import type { EmailContent } from "./templates";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export class EmailSendError extends Error {
  override readonly name = "EmailSendError";

  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

export async function sendWithResend(
  config: EmailConfig,
  content: EmailContent,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: config.from,
        to: [config.to],
        subject: content.subject,
        text: content.text,
        html: content.html,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new EmailSendError(
      error instanceof Error ? error.message : "email request failed",
      false,
    );
  }

  const payload = await response.json<unknown>().catch(() => undefined);
  if (!response.ok) {
    const message =
      errorMessage(payload) ?? `Resend returned HTTP ${response.status}`;
    const permanent =
      response.status >= 400 &&
      response.status < 500 &&
      ![408, 429].includes(response.status);
    throw new EmailSendError(message, permanent);
  }

  if (!isRecord(payload) || typeof payload["id"] !== "string") {
    throw new EmailSendError(
      "Resend response did not include a message ID",
      false,
    );
  }
  return payload["id"];
}

function errorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const message = payload["message"];
  return typeof message === "string" ? message.slice(0, 500) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
