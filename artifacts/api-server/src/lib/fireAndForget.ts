import type { AppLogger } from "./logger.js";

/**
 * fireAndForget — wraps a fire-and-forget async operation so it is
 * always logged on failure instead of silently swallowed.
 *
 * Usage:
 *   fireAndForget(emitWebhookEvent("order_delivered", payload), "webhook:order_delivered", logger);
 *   fireAndForget(db.delete(...), "otp-cleanup", logger, { userId, correlationId });
 *
 * The promise is NOT awaited. Errors are logged at `warn` level with the
 * full required schema { message, error, code, correlationId, timestamp }.
 * This keeps the response fast while ensuring failures are visible in logs.
 */
export function fireAndForget(
  promise: Promise<unknown>,
  label: string,
  log: AppLogger,
  meta?: Record<string, unknown>,
): void {
  promise.catch((err: unknown) => {
    const message = `[fireAndForget] ${label} failed`;
    log.warn(
      {
        label,
        message,
        error: err instanceof Error ? err.message : String(err),
        code: (err as { code?: string }).code ?? "FIRE_AND_FORGET_ERROR",
        correlationId: meta?.["correlationId"] ?? null,
        timestamp: new Date().toISOString(),
        ...meta,
      },
      message,
    );
  });
}
