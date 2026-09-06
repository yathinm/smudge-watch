export interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
  ALERT_EMAIL_TO?: string;
  ALERT_EMAIL_FROM?: string;
  ADMIN_TOKEN?: string;
}

export interface EmailConfig {
  apiKey: string;
  to: string;
  from: string;
}

export function emailConfig(env: Env): EmailConfig | undefined {
  const apiKey = env.RESEND_API_KEY?.trim();
  const to = env.ALERT_EMAIL_TO?.trim();
  const from = env.ALERT_EMAIL_FROM?.trim();
  if (!apiKey || !to || !from) return undefined;
  return { apiKey, to, from };
}

export function hasValidAdminToken(request: Request, env: Env): boolean {
  const expected = env.ADMIN_TOKEN?.trim();
  if (!expected) return false;
  const supplied = request.headers.get("Authorization");
  return supplied === `Bearer ${expected}`;
}
