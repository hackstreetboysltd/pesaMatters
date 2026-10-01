import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const here = dirname(fileURLToPath(import.meta.url));

export function createPool(databaseUrl: string): mysql.Pool {
  return mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 10,
    namedPlaceholders: true,
    timezone: "Z",
    dateStrings: true,
  });
}

export async function applySchema(pool: mysql.Pool): Promise<void> {
  const sql = readFileSync(join(here, "..", "sql", "schema.sql"), "utf8");
  const statements = sql
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  for (const statement of statements) {
    await pool.query(statement);
  }
}

export type Db = mysql.Pool;
export type Conn = mysql.PoolConnection;
