import assert from "node:assert/strict";
import test from "node:test";
import { safeReturnTo } from "../src/returnTo.ts";

test("safeReturnTo keeps relative app paths", () => {
  assert.equal(safeReturnTo("/"), "/");
  assert.equal(safeReturnTo("/move"), "/move");
  assert.equal(safeReturnTo("/invest/abc?x=1"), "/invest/abc?x=1");
});

test("safeReturnTo rejects open redirects and login loops", () => {
  assert.equal(safeReturnTo("https://evil.example/"), "/");
  assert.equal(safeReturnTo("//evil.example"), "/");
  assert.equal(safeReturnTo("/\\evil.example"), "/");
  assert.equal(safeReturnTo("/login"), "/");
  assert.equal(safeReturnTo("/login?error=x"), "/");
  assert.equal(safeReturnTo(null), "/");
  assert.equal(safeReturnTo(""), "/");
  assert.equal(safeReturnTo("move"), "/");
});
