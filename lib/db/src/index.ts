import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { pgPoolConfig } from "./connection-url";
import { createLogger } from "@workspace/logger";

const log = createLogger("[db:pool]");
const { Pool } = pg;

export const pool = new Pool({
  ...pgPoolConfig,
  max: parseInt(process.env.DB_POOL_MAX ?? "25"),
  min: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 30000,
  query_timeout: 60000,
});
export const db = drizzle(pool, { schema });

const telemetryInterval = setInterval(() => {
  log.info({
    totalConnections: pool.totalCount,
    idleConnections: pool.idleCount,
    waitingRequests: pool.waitingCount,
    timestamp: new Date().toISOString(),
  }, "pool metrics");
}, 5 * 60 * 1000);
telemetryInterval.unref();

let shutdownPromise: Promise<void> | null = null;
const shutdownPool = (signal: string): Promise<void> => {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    log.info(`${signal} received — draining pool connections`);
    try {
      await pool.end();
      log.info("Pool connections drained successfully");
    } catch (err) {
      log.error({ err }, "Error draining pool connections");
    }
  })();
  return shutdownPromise;
};

process.on("SIGTERM", () => { shutdownPool("SIGTERM"); });
process.on("SIGINT",  () => { shutdownPool("SIGINT"); });

export * from "./schema";
