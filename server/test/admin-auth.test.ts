import assert from "node:assert/strict";
import test from "node:test";
import { AdminGoogleError, adminFromGoogle } from "../src/loans/service.ts";
import type { Db, Row } from "../src/db.ts";

type Script = { sql: string; rows: Row[] };

function mockPool(scripts: Script[]): Db {
  let i = 0;
  return {
    query: async <T extends Row = Row>(sql: string): Promise<[T[]]> => {
      const step = scripts[i];
      if (step === undefined) throw new Error(`Unexpected query: ${sql}`);
      i += 1;
      assert.ok(sql.includes(step.sql) || step.sql === "*", `expected query containing ${step.sql}, got ${sql}`);
      return [step.rows as T[]];
    },
    getConnection: async () => {
      throw new Error("not used");
    },
    end: async () => undefined,
  } as unknown as Db;
}

test("adminFromGoogle matches an existing google_sub", async () => {
  const pool = mockPool([
    {
      sql: "google_sub",
      rows: [{ id: "a".repeat(32), name: "Ada", email: "ada@hackstreet.local" }],
    },
  ]);
  const admin = await adminFromGoogle(pool, { sub: "sub-1", email: "ada@hackstreet.local", name: "Ada" });
  assert.equal(admin.email, "ada@hackstreet.local");
  assert.equal(admin.name, "Ada");
});

test("adminFromGoogle links google_sub on email match", async () => {
  const pool = mockPool([
    { sql: "google_sub", rows: [] },
    {
      sql: "email",
      rows: [{ id: "b".repeat(32), name: "Bea", email: "bea@hackstreet.local", google_sub: null }],
    },
    { sql: "UPDATE", rows: [] },
  ]);
  const admin = await adminFromGoogle(pool, { sub: "sub-2", email: "bea@hackstreet.local", name: "Beatrice" });
  assert.equal(admin.id, "b".repeat(32));
  assert.equal(admin.email, "bea@hackstreet.local");
});

test("adminFromGoogle rejects unknown Google accounts", async () => {
  const pool = mockPool([
    { sql: "google_sub", rows: [] },
    { sql: "email", rows: [] },
  ]);
  await assert.rejects(
    () => adminFromGoogle(pool, { sub: "sub-x", email: "stranger@gmail.com", name: "X" }),
    (error: unknown) => error instanceof AdminGoogleError && error.code === "not_admin",
  );
});

test("adminFromGoogle rejects a conflicting google_sub on the same email", async () => {
  const pool = mockPool([
    { sql: "google_sub", rows: [] },
    {
      sql: "email",
      rows: [{ id: "c".repeat(32), name: "Cee", email: "cee@hackstreet.local", google_sub: "other-sub" }],
    },
  ]);
  await assert.rejects(
    () => adminFromGoogle(pool, { sub: "sub-new", email: "cee@hackstreet.local", name: "Cee" }),
    (error: unknown) => error instanceof AdminGoogleError && error.code === "google_conflict",
  );
});
