import assert from "node:assert/strict";
import test from "node:test";
import { safeAdminReturnTo, safeReturnTo } from "../src/returnTo.ts";

test("safeReturnTo rejects admin login loops", () => {
  assert.equal(safeReturnTo("/admin/login"), "/");
  assert.equal(safeReturnTo("/admin/login?x=1"), "/");
});

test("safeAdminReturnTo strips the /admin basename", () => {
  assert.equal(safeAdminReturnTo("/admin/crew"), "/crew");
  assert.equal(safeAdminReturnTo("/admin"), "/");
  assert.equal(safeAdminReturnTo("/money"), "/money");
  assert.equal(safeAdminReturnTo("/admin/login"), "/");
  assert.equal(safeAdminReturnTo("https://evil.example/"), "/");
});
