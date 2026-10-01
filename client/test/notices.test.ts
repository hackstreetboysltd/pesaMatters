import assert from "node:assert/strict";
import { test } from "node:test";
import type { LedgerBlock } from "../src/api.ts";
import {
  accountNotice,
  actionNotices,
  mergeNotices,
  noticeView,
  personalBlocks,
  readNotices,
  recordNotice,
  type NoticeStore,
} from "../src/notices.ts";

function memory(): NoticeStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function block(
  id: number,
  entryType: string,
  payload: Record<string, string | number | null>,
): LedgerBlock {
  return {
    id,
    prevHash: `prev-${id}`,
    hash: `hash-${id}`,
    entryType,
    payload,
    createdAt: `2026-10-0${id}T12:00:00.000Z`,
  };
}

const names = new Map([
  ["me", "Phil"],
  ["them", "Asha"],
]);

test("account creation is one stable notice", () => {
  const first = accountNotice("me", "2026-09-30T22:06:00.000Z");
  const again = accountNotice("me", "2026-09-30T22:06:00.000Z");
  const merged = mergeNotices([[first], [again]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.text, "Successfully created account");
  assert.equal(merged[0]?.at, "2026-09-30T22:06:00.000Z");
});

test("login does not add another account notice", () => {
  const created = accountNotice("me", "2026-09-30T22:06:00.000Z");
  const later = mergeNotices([[created], [accountNotice("me", "2026-09-30T22:06:00.000Z")]]);
  assert.equal(later.filter((notice) => notice.id.startsWith("account:")).length, 1);
});

test("own deposits, withdrawals, sends, and buys become success notices", () => {
  const blocks = [
    block(1, "deposit", { memberId: "me", amountCents: 100_000 }),
    block(2, "withdraw", { memberId: "me", amountCents: 2_500 }),
    block(3, "transfer", { memberId: "me", counterpartyId: "them", amountCents: 500 }),
    block(4, "transfer", { memberId: "them", counterpartyId: "me", amountCents: 800 }),
    block(5, "invest", { memberId: "me", symbol: "SCOM" }),
    block(6, "deposit", { memberId: "them", amountCents: 900 }),
    block(7, "mark", { memberId: "me", symbol: "SCOM", priceCents: 100 }),
    block(8, "genesis", {}),
  ];
  const texts = actionNotices(blocks, "me", names).map((notice) => notice.text);
  assert.deepEqual(texts, [
    "Successfully deposited KES 1,000",
    "Successfully withdrew KES 25",
    "Successfully sent KES 5 to Asha",
    "Successfully bought SCOM",
  ]);
});

test("activity keeps my deposits, buys, and transfers I sent or received", () => {
  const blocks = [
    block(1, "deposit", { memberId: "me", amountCents: 100 }),
    block(2, "deposit", { memberId: "them", amountCents: 100 }),
    block(3, "transfer", { memberId: "me", counterpartyId: "them", amountCents: 50 }),
    block(4, "transfer", { memberId: "them", counterpartyId: "me", amountCents: 80 }),
    block(5, "withdraw", { memberId: "me", amountCents: 10 }),
    block(6, "invest", { memberId: "me", symbol: "SCOM" }),
    block(7, "invest", { memberId: "them", symbol: "EQTY" }),
    block(8, "mark", { investmentId: "x", priceCents: 1 }),
  ];
  assert.deepEqual(
    personalBlocks(blocks, "me").map((item) => item.id),
    [1, 3, 4, 5, 6],
  );
});

test("info rows split a success into a title and a detail", () => {
  assert.deepEqual(noticeView({ id: "1", at: "2026-09-18T12:00:00.000Z", text: "Successfully deposited KES 1,000" }), {
    title: "Successfully deposited",
    detail: "KES 1,000",
  });
  assert.deepEqual(noticeView({ id: "2", at: "2026-09-18T12:00:00.000Z", text: "Successfully sent KES 100 to Alvin" }), {
    title: "Successfully sent",
    detail: "KES 100 to Alvin",
  });
  assert.deepEqual(noticeView({ id: "3", at: "2026-09-18T12:00:00.000Z", text: "Successfully changed theme to Kiln" }), {
    title: "Successfully changed theme",
    detail: "Kiln",
  });
  assert.deepEqual(noticeView(accountNotice("me", "2026-09-30T22:06:00.000Z")), {
    title: "Successfully created account",
    detail: "Your account is ready.",
  });
});

test("goal and theme notices append once per id and survive a bad store", () => {
  const store = memory();
  store.setItem("hackstreet-notices:me", "{");
  assert.deepEqual(readNotices("me", store), []);
  const goal = { id: "goal:1", at: "2026-10-01T10:00:00.000Z", text: "Successfully set goal to KES 5,000" };
  recordNotice("me", goal, store);
  recordNotice("me", goal, store);
  const theme = { id: "theme:1", at: "2026-10-01T11:00:00.000Z", text: "Successfully changed theme to Kiln" };
  const saved = recordNotice("me", theme, store);
  assert.equal(saved.length, 2);
  const shown = mergeNotices([[accountNotice("me", "2026-09-30T22:06:00.000Z")], saved]);
  assert.deepEqual(
    shown.map((notice) => notice.text),
    [
      "Successfully changed theme to Kiln",
      "Successfully set goal to KES 5,000",
      "Successfully created account",
    ],
  );
});
