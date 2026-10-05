import assert from "node:assert/strict";
import test from "node:test";
import { adminHealthOf } from "../src/admin/service.ts";
import { parseAdminGoogleEmails } from "../src/config.ts";

test("adminHealthOf is live when the books are quiet", () => {
  assert.equal(adminHealthOf({ ledgerOk: true, pendingPayments: 0, failedPaymentsWeek: 0 }), "live");
  assert.equal(adminHealthOf({ ledgerOk: true, pendingPayments: 5, failedPaymentsWeek: 0 }), "live");
});

test("adminHealthOf degrades on ledger failure, payment failures, or a long pending queue", () => {
  assert.equal(adminHealthOf({ ledgerOk: false, pendingPayments: 0, failedPaymentsWeek: 0 }), "degraded");
  assert.equal(adminHealthOf({ ledgerOk: true, pendingPayments: 0, failedPaymentsWeek: 1 }), "degraded");
  assert.equal(adminHealthOf({ ledgerOk: true, pendingPayments: 6, failedPaymentsWeek: 0 }), "degraded");
});

test("parseAdminGoogleEmails normalizes and dedupes", () => {
  assert.deepEqual(parseAdminGoogleEmails(undefined), []);
  assert.deepEqual(parseAdminGoogleEmails(" Ada@Gmail.com , bea@hackstreet.local,ada@gmail.com "), [
    "ada@gmail.com",
    "bea@hackstreet.local",
  ]);
  assert.deepEqual(parseAdminGoogleEmails("not-an-email, ok@x.co"), ["ok@x.co"]);
});
