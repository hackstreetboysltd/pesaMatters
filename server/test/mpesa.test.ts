import assert from "node:assert/strict";
import test from "node:test";
import { receiptFromB2c, receiptFromStk, B2cResultBody, StkCallbackBody } from "../src/mpesa/callback.ts";
import { darajaPassword, darajaTimestamp, parseStkPushResponse, stkOutcome } from "../src/mpesa/daraja.ts";
import { kenyanMsisdn } from "../src/mpesa/phone.ts";
import { receiptNumberFromHash, shownMpesaReceipt } from "../src/receiptNo.ts";
import { receiptPdf } from "../src/receiptPdf.ts";

test("daraja timestamp is fourteen Nairobi digits and the password is base64", () => {
  const stamp = darajaTimestamp(new Date("2026-10-01T12:00:00.000Z"));
  assert.match(stamp, /^\d{14}$/);
  assert.equal(darajaPassword("174379", "passkey", "20261001150000"), Buffer.from("174379passkey20261001150000").toString("base64"));
});

test("stk push rejects a non-zero response and maps result codes", () => {
  assert.throws(() => parseStkPushResponse({ ResponseCode: "1" }), /mpesa_stk_failed/);
  assert.equal(parseStkPushResponse({ ResponseCode: "0", CheckoutRequestID: "ws_CO_1", MerchantRequestID: "m" }).checkoutRequestId, "ws_CO_1");
  assert.equal(stkOutcome("0"), "paid");
  assert.equal(stkOutcome("4999"), "pending");
  assert.equal(stkOutcome("1032"), "failed");
});

test("kenyan numbers become 254 msisdn and reject short input", () => {
  assert.equal(kenyanMsisdn("0712 345 678"), "254712345678");
  assert.equal(kenyanMsisdn("+254712345678"), "254712345678");
  assert.equal(kenyanMsisdn("123"), null);
});

test("stk and b2c callbacks keep the receipt token", () => {
  const stk = StkCallbackBody.parse({
    Body: {
      stkCallback: {
        MerchantRequestID: "m",
        CheckoutRequestID: "ws",
        ResultCode: 0,
        CallbackMetadata: { Item: [{ Name: "MpesaReceiptNumber", Value: "UBK123" }] },
      },
    },
  });
  assert.equal(receiptFromStk(stk), "UBK123");
  const b2c = B2cResultBody.parse({ Result: { ResultCode: 0, ConversationID: "c", TransactionID: "XYZ9" } });
  assert.equal(receiptFromB2c(b2c), "XYZ9");
});

test("receipt number is the first 12 digits of the ledger hash", () => {
  const hash = "ab12cd34ef567890".padEnd(64, "a");
  assert.equal(receiptNumberFromHash(hash), "AB12-CD34-EF56");
  assert.equal(receiptNumberFromHash("ab12"), null);
  assert.equal(shownMpesaReceipt("MOCKE2BD8C"), null);
  assert.equal(shownMpesaReceipt("POTABCDEF12"), null);
  assert.equal(shownMpesaReceipt("UBK123"), "UBK123");
});

test("receipt pdf is a one-page document", () => {
  const hash = "ab12cd34ef567890".padEnd(64, "a");
  const file = receiptPdf({
    kind: "Add",
    amount: "KES 200",
    from: "Phil Kakai",
    to: null,
    when: "1 Oct 2026, 18:24",
    receiptNumber: "AB12-CD34-EF56",
    blockId: 33,
    blockHash: hash,
    mpesaReceipt: null,
  });
  const text = file.toString("utf8");
  assert.equal(file.subarray(0, 5).toString("utf8"), "%PDF-");
  assert.equal(text.includes("%%EOF"), true);
  assert.equal(text.includes("PesaMatters"), true);
  assert.equal(text.includes("AB12-CD34-EF56"), true);
  assert.equal(text.includes("/Count 1"), true);
});
