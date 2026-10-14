import assert from "node:assert/strict";
import type { Server } from "node:http";
import test from "node:test";
import type { Db } from "../src/db.ts";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

function listen(app: ReturnType<typeof createApp>): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("csrf cookie is set even when the browser sends a cached validator", async () => {
  const config = loadConfig({
    DATABASE_URL: "postgres://local/test",
    APP_ORIGIN: "http://127.0.0.1:8787",
    COOKIE_SECURE: "false",
    MPESA_MODE: "mock",
  });
  const app = createApp({} as Db, config);
  const server = await listen(app);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  try {
    const first = await fetch(`http://127.0.0.1:${address.port}/api/auth/csrf`);
    assert.equal(first.status, 200);
    const setCookie = first.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /hs_csrf=/);
    const etag = first.headers.get("etag");
    const second = await fetch(`http://127.0.0.1:${address.port}/api/auth/csrf`, {
      headers: etag !== null ? { "if-none-match": etag } : { "if-modified-since": "Wed, 21 Oct 2015 07:28:00 GMT" },
    });
    assert.equal(second.status, 200);
    assert.match(second.headers.get("set-cookie") ?? "", /hs_csrf=/);
    assert.match(second.headers.get("cache-control") ?? "", /no-store/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
