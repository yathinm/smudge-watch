import { describe, expect, it } from "vitest";

import { emailConfig, hasValidAdminToken } from "../src/config";
import type { Env } from "../src/config";

describe("configuration", () => {
  it("requires every email setting", () => {
    expect(emailConfig({} as Env)).toBeUndefined();
    expect(
      emailConfig({
        RESEND_API_KEY: "key",
        ALERT_EMAIL_TO: "owner@example.com",
        ALERT_EMAIL_FROM: "SmudgeWatch <onboarding@resend.dev>",
      } as Env),
    ).toEqual({
      apiKey: "key",
      to: "owner@example.com",
      from: "SmudgeWatch <onboarding@resend.dev>",
    });
  });

  it("accepts only the configured bearer token", () => {
    const env = { ADMIN_TOKEN: "correct" } as Env;
    expect(
      hasValidAdminToken(
        new Request("https://example.com", {
          headers: { Authorization: "Bearer correct" },
        }),
        env,
      ),
    ).toBe(true);
    expect(hasValidAdminToken(new Request("https://example.com"), env)).toBe(
      false,
    );
    expect(
      hasValidAdminToken(new Request("https://example.com"), {} as Env),
    ).toBe(false);
  });
});
