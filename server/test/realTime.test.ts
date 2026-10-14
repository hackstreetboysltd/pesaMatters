import assert from "node:assert/strict";
import test from "node:test";
import {
  realNowMs,
  realTimeSource,
  resetRealTimeForTests,
  syncRealTime,
} from "../src/realTime.ts";

function jsonResponse(body: string, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  if (init.headers !== undefined) {
    return new Response(body, { status, headers: init.headers });
  }
  return new Response(body, { status });
}

test("Cloudflare trace sets a network offset", async () => {
  const remoteSec = 1_700_000_000.123;
  resetRealTimeForTests(async (input) => {
    const url = String(input);
    if (url.includes("cloudflare.com/cdn-cgi/trace")) {
      return jsonResponse(`fl=1\nts=${remoteSec}\nh=cloudflare.com\n`);
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  await syncRealTime();
  assert.equal(realTimeSource(), "network");
  const expected = Math.round(remoteSec * 1000);
  const skew = Math.abs(realNowMs() - expected);
  assert.ok(skew < 50, `skew ${skew}ms`);
});

test("Google Date header is used when Cloudflare fails", async () => {
  const remote = Date.parse("2026-10-05T07:00:00.000Z");
  resetRealTimeForTests(async (input, init) => {
    const url = String(input);
    if (url.includes("cloudflare.com")) {
      return jsonResponse("nope", { ok: false, status: 503 });
    }
    if (url.includes("generate_204")) {
      assert.equal(init?.method, "HEAD");
      return jsonResponse("", {
        headers: { date: "Mon, 05 Oct 2026 07:00:00 GMT" },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  await syncRealTime();
  assert.equal(realTimeSource(), "network");
  assert.ok(Math.abs(realNowMs() - remote) < 50);
});

test("both sources failing leave the host clock", async () => {
  resetRealTimeForTests(async () => {
    throw new Error("offline");
  });

  const before = Date.now();
  await syncRealTime();
  const after = Date.now();
  assert.equal(realTimeSource(), "host");
  const now = realNowMs();
  assert.ok(now >= before - 5 && now <= after + 5);
});
