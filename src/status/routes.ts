import type { Env } from "../config";
import { emailConfig, hasValidAdminToken } from "../config";
import { eventEmail } from "../email/templates";
import { sendWithResend } from "../email/resend-client";
import { runMonitor } from "../monitoring/monitor";
import { D1MonitorRepository } from "../persistence/d1-repository";

export async function handleRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const repository = new D1MonitorRepository(env.DB);

  if (request.method === "GET" && url.pathname === "/") {
    const status = await repository.listStatus();
    const health = await repository.getHealth();
    return new Response(renderStatus(status, health.lastRunAt), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
  if (request.method === "GET" && url.pathname === "/api/status") {
    return Response.json(await repository.listStatus(), noStore());
  }
  if (request.method === "GET" && url.pathname === "/api/events") {
    return Response.json(await repository.listEvents(50), noStore());
  }
  if (request.method === "GET" && url.pathname === "/health") {
    const health = await repository.getHealth();
    const unhealthy = health.sources.some(
      (source) => source.consecutiveFailures >= 3,
    );
    return Response.json(
      {
        status: unhealthy ? "degraded" : "ok",
        emailConfigured: emailConfig(env) !== undefined,
        lastRunAt: health.lastRunAt ?? null,
        sources: health.sources.map((source) => ({
          id: source.id,
          lastSuccessAt: source.lastSuccessAt ?? null,
          consecutiveFailures: source.consecutiveFailures,
        })),
      },
      { status: unhealthy ? 503 : 200, ...noStore() },
    );
  }
  if (request.method === "POST" && url.pathname.startsWith("/admin/")) {
    if (!hasValidAdminToken(request, env)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (url.pathname === "/admin/run") {
      return Response.json(
        await runMonitor(repository, emailConfig(env), { force: true }),
      );
    }
    if (url.pathname === "/admin/test-email") {
      const config = emailConfig(env);
      if (!config)
        return Response.json(
          { error: "email is not configured" },
          { status: 503 },
        );
      const now = Date.now();
      const content = eventEmail({
        type: "source_recovered",
        sourceId: "test",
        retailer: "jellycat-us",
        productKey: "test",
        productName: "SmudgeWatch test email",
        purchaseUrl: "https://us.jellycat.com/smudge-monkey/",
        detectedAt: now,
      });
      const messageId = await sendWithResend(
        config,
        content,
        `smudge-watch-test-${now}`,
      );
      return Response.json({ accepted: true, messageId });
    }
  }
  return Response.json({ error: "not found" }, { status: 404 });
}

function noStore(): ResponseInit {
  return { headers: { "Cache-Control": "no-store" } };
}

function renderStatus(
  variants: Awaited<ReturnType<D1MonitorRepository["listStatus"]>>,
  lastRunAt: number | undefined,
): string {
  const rows = variants.length
    ? variants
        .map(
          (variant) => `<tr>
            <td>${escapeHtml(retailerName(variant.retailer))}</td>
            <td>${escapeHtml(variant.productName)}</td>
            <td><span class="state state-${escapeHtml(variant.availability)}">${escapeHtml(variant.availability)}</span></td>
            <td>${variant.priceMinor === undefined ? "—" : escapeHtml(formatPrice(variant.priceMinor, variant.currency))}</td>
            <td>${escapeHtml(new Date(variant.lastSeenAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }))}</td>
            <td><a href="${escapeHtml(variant.purchaseUrl)}" rel="noreferrer">Open</a></td>
          </tr>`,
        )
        .join("")
    : '<tr><td colspan="6">No baseline has been recorded yet.</td></tr>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SmudgeWatch</title><style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:1000px;margin:48px auto;padding:0 20px;color:#17202a;background:#f7f8fa}
h1{margin-bottom:4px}.meta{color:#667085;margin-top:0}table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px #0001}
th,td{text-align:left;padding:14px;border-bottom:1px solid #eaecf0}th{background:#f2f4f7}.state{font-weight:700}.state-available{color:#067647}.state-unavailable,.state-retired{color:#b42318}.state-unknown{color:#b54708}a{color:#175cd3}
</style></head><body><h1>SmudgeWatch</h1><p class="meta">Last run: ${lastRunAt ? escapeHtml(new Date(lastRunAt).toLocaleString()) : "never"}</p>
<table><thead><tr><th>Retailer</th><th>Product</th><th>Status</th><th>Price</th><th>Checked</th><th>Link</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function retailerName(value: string): string {
  return value === "jellycat-us"
    ? "Jellycat US"
    : value === "nordstrom-us"
      ? "Nordstrom"
      : value;
}

function formatPrice(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    value / 100,
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
