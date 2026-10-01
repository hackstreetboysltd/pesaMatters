import assert from "node:assert/strict";
import test from "node:test";
import {
  QuoteError,
  barsFromChart,
  barsFromYahoo,
  closesInShillings,
  completedCloses,
  completedUsCloses,
  dayChangeBps,
  dollarsToCents,
  formatDayPercent,
  kesPerUsd,
  listingSymbol,
  msUntilNextCloseTick,
  nameFromQuotePage,
  nextCloseTick,
  nseSymbol,
  priceTextToCents,
  quoteFromPages,
} from "../src/quotes.ts";
import { parseNseDirectory, parseNyseDirectory } from "../src/symbols.ts";

const CHART = `data:[[d("2026-09-28"),93.25],[d("2026-09-29"),92.50],[d("2026-09-30"),91.25],[d("2026-10-01"),90]]`;
const PAGE = "<title>KCB Group Plc (NSE:KCB) Stock Quote</title>";

test("NSE symbols are short letter codes", () => {
  assert.equal(nseSymbol(" scom "), "SCOM");
  assert.throws(() => nseSymbol("SCOM.NR"), QuoteError);
  assert.throws(() => nseSymbol("../etc"), QuoteError);
});

test("published prices become cents", () => {
  assert.equal(priceTextToCents("36.20"), 3620);
  assert.equal(priceTextToCents("91.25"), 9125);
  assert.equal(priceTextToCents("0"), null);
});

test("day move is signed basis points", () => {
  assert.equal(dayChangeBps(10_000, 10_150), 150);
  assert.equal(dayChangeBps(10_000, 9_280), -720);
  assert.equal(formatDayPercent(150), "+1.5%");
  assert.equal(formatDayPercent(-720), "−7.2%");
});

test("today's bar is not a close", () => {
  const bars = barsFromChart(CHART);
  const done = completedCloses(bars, "2026-10-01");
  assert.equal(done.length, 3);
  assert.equal(done[2]?.sessionDate, "2026-09-30");
  assert.equal(done[2]?.closeCents, 9125);
});

test("a quote keeps the company name and the last two closes", () => {
  const quote = quoteFromPages("KCB", CHART, PAGE, "2026-10-01");
  assert.equal(quote.name, "KCB Group Plc");
  assert.equal(quote.closes.at(-1)?.closeCents, 9125);
  assert.equal(nameFromQuotePage("<html></html>"), null);
  assert.throws(() => quoteFromPages("NOPE", "<html></html>", PAGE, "2026-10-01"), QuoteError);
});

const DIRECTORY = [
  "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol",
  "IBM|International Business Machines Common Stock|N|IBM|N|100|N|IBM",
  "SPY|SPDR S&P 500 ETF|P|SPY|Y|100|N|SPY",
  "BF.B|Brown-Forman Corporation Class B|N|BF.B|N|100|N|BF.B",
  "AAC.W|Ares Acquisition Warrant|N|AAC.W|N|100|N|AAC.W",
  "ZZZ|Test Issue|N|ZZZ|N|100|Y|ZZZ",
].join("\n");

test("the NYSE list keeps common shares and class shares", () => {
  const rows = parseNyseDirectory(DIRECTORY);
  assert.deepEqual(
    rows.map((row) => row.symbol),
    ["BF.B", "IBM"],
  );
  assert.equal(listingSymbol(" bf.b "), "BF.B");
  assert.throws(() => listingSymbol("IBM/X"), QuoteError);
});

const NSE_PAGE = `
<table>
<tr><td><a href="/nse/scom.html" title="Safaricom Plc">SCOM</a><td><a href="/nse/scom.html" title="Safaricom Plc">Safaricom Plc</a>
<tr><td><a href="/nse/eqty.html" title="Equity Group Holdings Limited">EQTY</a><td><a href="/nse/eqty.html" title="Equity Group Holdings Limited">Equity Group Holdings Limited</a>
<tr><td><a href="/nse/imh.html" title="I&amp;M Holdings Plc">IMH</a><td><a href="/nse/imh.html" title="I&amp;M Holdings Plc">I&amp;M Holdings Plc</a>
<tr><td><a href="/nse/gld.html" title="Absa NewGold ETF">GLD</a><td><a href="/nse/gld.html" title="Absa NewGold ETF">Absa NewGold ETF</a>
</table>
`;

test("the NSE list keeps named Nairobi shares for Kingdom Securities", () => {
  const rows = parseNseDirectory(NSE_PAGE);
  assert.deepEqual(
    rows.map((row) => row.symbol),
    ["GLD", "EQTY", "IMH", "SCOM"],
  );
  assert.equal(rows.find((row) => row.symbol === "IMH")?.name, "I&M Holdings Plc");
  assert.equal(rows.find((row) => row.symbol === "SCOM")?.name, "Safaricom Plc");
});

test("a New York close converts to shillings at one rate", () => {
  const now = new Date("2026-10-01T21:30:00.000Z");
  const bars = barsFromYahoo({
    chart: {
      result: [
        {
          timestamp: [1790688600, 1790775000],
          indicators: { quote: [{ close: [100, 101.5] }] },
        },
      ],
    },
  });
  const done = completedUsCloses(bars, now);
  assert.equal(done.length, 2);
  assert.equal(dollarsToCents(101.5), 10150);
  const kes = closesInShillings(done, 100);
  assert.equal(kes[1]?.closeCents, 1_015_000);
  assert.equal(dayChangeBps(kes[0]?.closeCents ?? 0, kes[1]?.closeCents ?? 0), 150);
  assert.equal(kesPerUsd({ usd: { kes: 129.5 } }), 129.5);
  assert.equal(kesPerUsd({}), null);
});

test("the close job is aimed at 00:01 Nairobi", () => {
  const before = nextCloseTick(new Date("2026-09-30T20:00:00.000Z"));
  assert.equal(before.toISOString(), "2026-09-30T21:01:00.000Z");
  const after = nextCloseTick(new Date("2026-09-30T21:01:00.000Z"));
  assert.equal(after.toISOString(), "2026-10-01T21:01:00.000Z");
  const wait = msUntilNextCloseTick(new Date("2026-09-30T21:00:00.000Z"));
  assert.equal(wait, 60_000);
});
