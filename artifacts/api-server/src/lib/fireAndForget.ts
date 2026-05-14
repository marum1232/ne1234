import type { AppLogger } from "./logger.js";

/**
 * fireAndForget — wraps a fire-and-forget async operation so it is
 * always logged on failure instead of silently swallowed.
 *
 * Usage:
 *   fireAndForget(emitWebhookEvent("order_delivered", payload), "webhook:order_delivered", logger);
 *   fireAndForget(db.delete(...), "otp-cleanup", logger, { userId });
 *
 * The promise is NOT awaited. Errors are logged at `warn` level with the
 * supplied label and optional metadata. This keeps the response fast while
 * ensuring that failures are visible in structured logs.
 */
export function fireAndForget(
  promise: Promise<unknown>,
  label: string,
  log: AppLogger,
  meta?: Record<string, unknown>,
): void {
  promise.catch((err: unknown) => {
    log.warn(
      {
        label,
        err: err instanceof Error ? err.message : String(err),
        code: (err as { code?: string }).code ?? "FIRE_AND_FORGET_ERROR",
        timestamp: new Date().toISOString(),
        ...meta,
      },
      `[fireAndForget] ${label} failed`,
    );
  });
}
