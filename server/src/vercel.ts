import { resolve } from "node:path";
import dotenv from "dotenv";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createPool } from "./db.ts";
import { createQuoteSource } from "./quotes.ts";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "../.env") });

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const quotes = createQuoteSource();

export default createApp(pool, config, quotes);
