import dotenv from "dotenv";
import { resolve } from "node:path";
import { applySchema, createPool } from "../src/db.ts";
import { log } from "../src/logger.ts";

dotenv.config({ path: resolve(process.cwd(), "../.env") });
dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "../../.env") });

const url = process.env.DATABASE_URL;
if (url === undefined || url.length === 0) {
  throw new Error("DATABASE_URL is required");
}

const pool = createPool(url);
try {
  await applySchema(pool);
  log.info("schema_applied");
} finally {
  await pool.end();
}
