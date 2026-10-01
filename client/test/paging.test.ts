import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_SIZE, pageRangeLabel, pageWindow } from "../src/paging.ts";

test("first page shows the first ten of a longer list", () => {
  const slice = pageWindow(25, 0);
  assert.equal(PAGE_SIZE, 10);
  assert.deepEqual(slice, { page: 0, pageCount: 3, start: 0, end: 10, from: 1, to: 10 });
  assert.equal(pageRangeLabel(slice, 25), "1–10 of 25");
});

test("last page shows the remainder", () => {
  const slice = pageWindow(25, 2);
  assert.deepEqual(slice, { page: 2, pageCount: 3, start: 20, end: 25, from: 21, to: 25 });
  assert.equal(pageRangeLabel(slice, 25), "21–25 of 25");
});

test("a page past the end clamps to the last page", () => {
  assert.equal(pageWindow(11, 9).page, 1);
  assert.equal(pageWindow(11, 9).from, 11);
  assert.equal(pageWindow(11, 9).to, 11);
});

test("a negative page clamps to the first page", () => {
  assert.equal(pageWindow(11, -3).page, 0);
  assert.equal(pageWindow(11, -3).from, 1);
});

test("an empty list is one blank page", () => {
  const slice = pageWindow(0, 0);
  assert.deepEqual(slice, { page: 0, pageCount: 1, start: 0, end: 0, from: 0, to: 0 });
  assert.equal(pageRangeLabel(slice, 0), "0 of 0");
});

test("exactly one page fills from 1 to the page size", () => {
  const slice = pageWindow(10, 0);
  assert.equal(slice.pageCount, 1);
  assert.equal(pageRangeLabel(slice, 10), "1–10 of 10");
});

test("rejects a bad total or page size", () => {
  assert.throws(() => pageWindow(-1, 0), RangeError);
  assert.throws(() => pageWindow(1.5, 0), RangeError);
  assert.throws(() => pageWindow(10, 0, 0), RangeError);
});
