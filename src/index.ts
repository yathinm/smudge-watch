import type { Env } from "./config";
import { emailConfig } from "./config";
import { runMonitor } from "./monitoring/monitor";
import { D1MonitorRepository } from "./persistence/d1-repository";
import { handleRequest } from "./status/routes";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },

  scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): void {
    const repository = new D1MonitorRepository(env.DB);
    ctx.waitUntil(
      runMonitor(repository, emailConfig(env), {
        now: controller.scheduledTime,
        browser: env.BROWSER,
      }).then(async (stats) => {
        if (new Date(controller.scheduledTime).getUTCHours() === 8) {
          await repository.cleanup(
            controller.scheduledTime - 30 * 24 * 60 * 60 * 1000,
          );
        }
        console.log(
          JSON.stringify({
            level: "info",
            event: "monitor_complete",
            ...stats,
          }),
        );
      }),
    );
  },
} satisfies ExportedHandler<Env>;
