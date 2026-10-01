import dotenv from "dotenv";
import { resolve } from "node:path";
import { createApp } from "./app.ts";
import { startCloseScheduler } from "./closes.ts";
import { loadConfig } from "./config.ts";
import { applySchema, createPool } from "./db.ts";
import { log } from "./logger.ts";
import { createQuoteSource } from "./quotes.ts";
import { ensureDeskAdmin, seedLoanProducts } from "./loans/service.ts";
import { ensureGenesis, seedCrew } from "./store.ts";

dotenv.config({ path: resolve(process.cwd(), "../.env") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const quotes = createQuoteSource();
const app = createApp(pool, config, quotes);

async function boot(): Promise<void> {
  await applySchema(pool);
  await ensureGenesis(pool);
  await seedCrew(pool, config.seedPassword);
  await seedLoanProducts(pool);
  await ensureDeskAdmin(pool, config.deskEmail, config.deskPassword);
  await pool.query("SELECT 1 AS ok");
  const stopCloses = startCloseScheduler(pool, quotes);
  const server = app.listen(config.port, () => {
    log.info("listening", { port: config.port });
  });
  function shutdown(signal: string): void {
    log.info("shutdown", { signal });
    stopCloses();
    server.close(() => {
      pool
        .end()
        .then(() => {
          process.exit(0);
        })
        .catch(() => {
          process.exit(1);
        });
    });
  }
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
}

boot().catch((error: unknown) => {
  log.error("boot_failed", { name: error instanceof Error ? error.name : "unknown" });
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  log.error("unhandled_rejection", { name: reason instanceof Error ? reason.name : "unknown" });
  process.exit(1);
});
process.on("uncaughtException", (error: Error) => {
  log.error("uncaught_exception", { name: error.name });
  process.exit(1);
});
