import dotenv from "dotenv";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.ts";
import { createPool } from "../src/db.ts";
import { log } from "../src/logger.ts";
import { ensureDeskAdmin, seedLoanProducts } from "../src/loans/service.ts";
import { ensureGenesis, seedCrew } from "../src/store.ts";

dotenv.config({ path: resolve(process.cwd(), "../.env") });
dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "../../.env") });

const config = loadConfig();
const pool = createPool(config.databaseUrl);
try {
  await ensureGenesis(pool);
  await seedCrew(pool, config.seedPassword);
  await seedLoanProducts(pool);
  await ensureDeskAdmin(pool, config.deskEmail, config.deskPassword);
  log.info("seed_done");
} finally {
  await pool.end();
}
