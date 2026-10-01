import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dns from "node:dns";
import pg from "pg";

// Neon DNS often returns IPv6 first; some local networks refuse it (EACCES).
dns.setDefaultResultOrder("ipv4first");

const here = dirname(fileURLToPath(import.meta.url));

/** Keep BIGINT within JS number range for this ledger (cents / micro-units). */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
/** DATE as YYYY-MM-DD string so nullableDate keeps working. */
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export type Row = Record<string, unknown>;

/** Convert mysql-style `?` placeholders to Postgres `$1`, `$2`, … */
export function toPg(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

function sslOption(databaseUrl: string): boolean | { rejectUnauthorized: boolean } | undefined {
  if (databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1")) return undefined;
  if (databaseUrl.includes("sslmode=disable")) return undefined;
  if (databaseUrl.includes("neon.tech") || databaseUrl.includes("sslmode=require")) {
    return { rejectUnauthorized: true };
  }
  return undefined;
}

export class Conn {
  private readonly client: pg.PoolClient;

  constructor(client: pg.PoolClient) {
    this.client = client;
  }

  async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<[T[]]> {
    const text = toPg(sql);
    const result =
      params.length === 0 ? await this.client.query(text) : await this.client.query(text, params);
    return [result.rows as T[]];
  }

  async beginTransaction(): Promise<void> {
    await this.client.query("BEGIN");
  }

  async commit(): Promise<void> {
    await this.client.query("COMMIT");
  }

  async rollback(): Promise<void> {
    await this.client.query("ROLLBACK");
  }

  release(): void {
    this.client.release();
  }
}

export class Pool {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<[T[]]> {
    const text = toPg(sql);
    const result = params.length === 0 ? await this.pool.query(text) : await this.pool.query(text, params);
    return [result.rows as T[]];
  }

  async getConnection(): Promise<Conn> {
    return new Conn(await this.pool.connect());
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

export type Db = Pool;

export function createPool(databaseUrl: string): Pool {
  const serverless = process.env["VERCEL"] === "1";
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: serverless ? 1 : 10,
    ssl: sslOption(databaseUrl),
  });
  return new Pool(pool);
}

/** Apply schema.sql. Prefer `npm run db:migrate` over calling this on every request. */
export async function applySchema(pool: Db): Promise<void> {
  const candidates = [
    join(here, "..", "sql", "schema.sql"),
    join(process.cwd(), "server", "sql", "schema.sql"),
    join(process.cwd(), "sql", "schema.sql"),
  ];
  let sql: string | null = null;
  for (const path of candidates) {
    try {
      sql = readFileSync(path, "utf8");
      break;
    } catch {
      continue;
    }
  }
  if (sql === null) {
    throw new Error("schema.sql not found");
  }
  await pool.query(sql);
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
