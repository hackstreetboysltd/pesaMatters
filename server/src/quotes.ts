/**
 * Free closes. Kingdom Securities buys and Nairobi marks come from the public
 * Kwayisi NSE pages. Any New York lot already on the books still uses Yahoo's
 * daily chart plus a free USD→KES rate so the pot stays in shillings.
 */

import { findNseShare, findNyseShare } from "./symbols.ts";

export const NAIROBI = "Africa/Nairobi";

const HOST = "afx.kwayisi.org";
const YAHOO = "https://query1.finance.yahoo.com";
const FX_URL = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json";
const NEW_YORK = "America/New_York";
const POINT = /d\("(\d{4}-\d{2}-\d{2})"\),(\d+(?:\.\d+)?)\]/g;
const TITLE = /<title>([^<]{1,160})<\/title>/i;

export class QuoteError extends Error {
  readonly code: "bad_symbol" | "unknown_symbol" | "quote_unavailable";

  constructor(code: QuoteError["code"], message: string) {
    super(message);
    this.name = "QuoteError";
    this.code = code;
  }
}

export type CloseBar = {
  sessionDate: string;
  closeCents: number;
};

export type CloseQuote = {
  symbol: string;
  name: string;
  closes: CloseBar[];
  /** Latest close in the listing currency, before the shilling conversion. */
  listedCloseCents: number | null;
  /** Shillings per one US dollar. Null for a Nairobi close that is already in KES. */
  fxKesPerUsd: number | null;
};

export type QuoteSource = {
  load(symbol: string, todayNairobi: string, fresh: boolean): Promise<CloseQuote>;
};

/** Tickers that may be typed or chosen. Dots are class shares such as BF.B. */
export function listingSymbol(raw: string): string {
  const symbol = raw.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)) {
    throw new QuoteError("bad_symbol", "Use the ticker, like IBM.");
  }
  return symbol;
}

/** NSE tickers are short letter codes. Anything else never reaches the network. */
export function nseSymbol(raw: string): string {
  const symbol = raw.trim().toUpperCase();
  if (!/^[A-Z]{1,12}$/.test(symbol)) {
    throw new QuoteError("bad_symbol", "Use the NSE ticker, like SCOM.");
  }
  return symbol;
}

/** Whole shillings plus up to two decimals, rounded from the published figure. */
export function priceTextToCents(text: string): number | null {
  if (!/^\d{1,8}(?:\.\d+)?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  if (whole === undefined) return null;
  const padded = frac.padEnd(3, "0");
  const hundredths = Number(padded.slice(0, 2));
  const roundUp = padded[2] !== undefined && padded[2] >= "5";
  const cents = Number(whole) * 100 + hundredths + (roundUp ? 1 : 0);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000_000_00) return null;
  return cents;
}

export function dayChangeBps(priorCents: number, latestCents: number): number | null {
  if (!Number.isInteger(priorCents) || priorCents <= 0) return null;
  if (!Number.isInteger(latestCents) || latestCents <= 0) return null;
  return Math.round(((latestCents - priorCents) * 10_000) / priorCents);
}

/** One decimal, with a sign. 150 bps is +1.5%. −720 bps is −7.2%. */
export function formatDayPercent(bps: number): string {
  const tenths = Math.round(Math.abs(bps) / 10);
  const text = `${Math.floor(tenths / 10)}.${tenths % 10}`;
  return `${bps < 0 ? "−" : "+"}${text}%`;
}

export function nairobiDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NAIROBI,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Next 00:01 Africa/Nairobi. Nairobi is UTC+3 all year, so 00:01 is 21:01 UTC
 * the previous calendar day.
 */
export function nextCloseTick(now: Date): Date {
  const today = nairobiDate(now);
  const parts = today.split("-").map((part) => Number(part));
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("Nairobi date did not parse");
  }
  const todayTick = new Date(Date.UTC(year, month - 1, day, 0, 1, 0) - 3 * 60 * 60 * 1000);
  if (now.getTime() < todayTick.getTime()) return todayTick;
  return new Date(todayTick.getTime() + 24 * 60 * 60 * 1000);
}

export function msUntilNextCloseTick(now: Date): number {
  const delta = nextCloseTick(now).getTime() - now.getTime();
  return delta > 0 ? delta : delta + 24 * 60 * 60 * 1000;
}

export function barsFromChart(html: string): CloseBar[] {
  const bars: CloseBar[] = [];
  for (const match of html.matchAll(POINT)) {
    const sessionDate = match[1];
    const price = match[2];
    if (sessionDate === undefined || price === undefined) continue;
    const closeCents = priceTextToCents(price);
    if (closeCents === null) continue;
    bars.push({ sessionDate, closeCents });
  }
  return bars;
}

/** Drop the session dated today. That bar is not a close yet. */
export function completedCloses(bars: CloseBar[], todayNairobi: string): CloseBar[] {
  return bars.filter((bar) => bar.sessionDate < todayNairobi);
}

export function nameFromQuotePage(html: string): string | null {
  const match = TITLE.exec(html);
  const title = match?.[1];
  if (title === undefined) return null;
  const name = title.replace(/\s*\(NSE:.*$/i, "").replace(/\s*stock quote\s*$/i, "").trim();
  if (name.length === 0 || name.length > 80) return null;
  return name;
}

export function quoteFromPages(symbol: string, chartHtml: string, pageHtml: string, todayNairobi: string): CloseQuote {
  const closes = completedCloses(barsFromChart(chartHtml), todayNairobi);
  if (closes.length === 0) {
    throw new QuoteError("unknown_symbol", "That ticker has no published close on the free NSE list.");
  }
  return {
    symbol,
    name: nameFromQuotePage(pageHtml) ?? symbol,
    closes,
    listedCloseCents: null,
    fxKesPerUsd: null,
  };
}

const cache = new Map<string, { at: number; quote: CloseQuote }>();
const CACHE_MS = 15 * 60 * 1000;

export function clearQuoteCache(): void {
  cache.clear();
}

async function readPage(path: string): Promise<string> {
  const url = `https://${HOST}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
      headers: {
        Accept: "text/html, */*",
        "User-Agent": "Mozilla/5.0 (compatible; pesaMatters/1.0; +https://127.0.0.1)",
      },
    });
    if (response.status === 404) {
      throw new QuoteError("unknown_symbol", "That ticker is not on the free NSE list.");
    }
    if (!response.ok) {
      throw new QuoteError("quote_unavailable", "The free close feed did not answer. Try again shortly.");
    }
    const text = await response.text();
    if (text.length > 500_000) {
      throw new QuoteError("quote_unavailable", "The free close feed sent an unexpected page.");
    }
    return text;
  } catch (error) {
    if (error instanceof QuoteError) throw error;
    throw new QuoteError("quote_unavailable", "The free close feed did not answer. Try again shortly.");
  } finally {
    clearTimeout(timer);
  }
}

export function nyDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NEW_YORK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function nyMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: NEW_YORK,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return 0;
  return hour * 60 + minute;
}

/** Today's New York bar counts only after the cash close. */
export function completedUsCloses(bars: CloseBar[], now: Date): CloseBar[] {
  const today = nyDate(now);
  const afterClose = nyMinutes(now) >= 16 * 60 + 5;
  return bars.filter((bar) => bar.sessionDate < today || (afterClose && bar.sessionDate === today));
}

export function dollarsToCents(price: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const cents = Math.round(price * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000_000_00) return null;
  return cents;
}

export function barsFromYahoo(payload: unknown): CloseBar[] {
  if (typeof payload !== "object" || payload === null) return [];
  const result = (payload as { chart?: { result?: unknown[] } }).chart?.result?.[0];
  if (typeof result !== "object" || result === null) return [];
  const timestamps = (result as { timestamp?: unknown }).timestamp;
  const closes = (result as { indicators?: { quote?: { close?: unknown }[] } }).indicators?.quote?.[0]?.close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return [];
  const bars: CloseBar[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const stamp = timestamps[index];
    const close = closes[index];
    if (typeof stamp !== "number" || typeof close !== "number") continue;
    const closeCents = dollarsToCents(close);
    if (closeCents === null) continue;
    bars.push({ sessionDate: nyDate(new Date(stamp * 1000)), closeCents });
  }
  return bars;
}

export function kesPerUsd(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const kes = (payload as { usd?: { kes?: unknown } }).usd?.kes;
  if (typeof kes !== "number" || !Number.isFinite(kes) || kes <= 0 || kes > 10_000) return null;
  return kes;
}

export function closesInShillings(bars: CloseBar[], rate: number): CloseBar[] {
  return bars.map((bar) => ({
    sessionDate: bar.sessionDate,
    closeCents: Math.round(bar.closeCents * rate),
  }));
}

export function yahooShortName(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const result = (payload as { chart?: { result?: { meta?: { shortName?: unknown } }[] } }).chart?.result?.[0];
  const name = result?.meta?.shortName;
  if (typeof name !== "string") return null;
  const clean = name.trim().slice(0, 80);
  return clean.length === 0 ? null : clean;
}

async function readJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });
    if (response.status === 404) {
      throw new QuoteError("unknown_symbol", "That ticker has no published close.");
    }
    if (!response.ok) {
      throw new QuoteError("quote_unavailable", "The free close feed did not answer. Try again shortly.");
    }
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof QuoteError) throw error;
    throw new QuoteError("quote_unavailable", "The free close feed did not answer. Try again shortly.");
  } finally {
    clearTimeout(timer);
  }
}

let fxCache: { at: number; rate: number } | null = null;

async function usdToKesRate(fresh: boolean): Promise<number> {
  if (!fresh && fxCache !== null && Date.now() - fxCache.at < CACHE_MS) return fxCache.rate;
  const rate = kesPerUsd(await readJson(FX_URL));
  if (rate === null) {
    if (fxCache !== null) return fxCache.rate;
    throw new QuoteError("quote_unavailable", "The free dollar rate did not answer. Try again shortly.");
  }
  fxCache = { at: Date.now(), rate };
  return rate;
}

async function loadNyseQuote(symbol: string, listedName: string, fresh: boolean): Promise<CloseQuote> {
  const key = `NYSE:${symbol}`;
  if (!fresh) {
    const hit = cache.get(key);
    if (hit !== undefined && Date.now() - hit.at < CACHE_MS) return hit.quote;
  }
  const yahooSymbol = encodeURIComponent(symbol.replaceAll(".", "-"));
  const [chart, rate] = await Promise.all([
    readJson(`${YAHOO}/v8/finance/chart/${yahooSymbol}?interval=1d&range=10d`),
    usdToKesRate(fresh),
  ]);
  const usd = completedUsCloses(barsFromYahoo(chart), new Date());
  if (usd.length === 0) {
    throw new QuoteError("unknown_symbol", "That ticker has no published close.");
  }
  const latestUsd = usd[usd.length - 1];
  const quote: CloseQuote = {
    symbol,
    name: yahooShortName(chart) ?? listedName,
    closes: closesInShillings(usd, rate),
    listedCloseCents: latestUsd?.closeCents ?? null,
    fxKesPerUsd: rate,
  };
  cache.set(key, { at: Date.now(), quote });
  return quote;
}

async function loadNairobiQuote(symbol: string, todayNairobi: string, fresh: boolean): Promise<CloseQuote> {
  const ticker = nseSymbol(symbol);
  const key = `NSE:${ticker}:${todayNairobi}`;
  if (!fresh) {
    const hit = cache.get(key);
    if (hit !== undefined && Date.now() - hit.at < CACHE_MS) return hit.quote;
  }
  const lower = ticker.toLowerCase();
  const [chartHtml, pageHtml] = await Promise.all([
    readPage(`/chart/nse/${lower}`),
    readPage(`/nse/${lower}.html`),
  ]);
  const quote = quoteFromPages(ticker, chartHtml, pageHtml, todayNairobi);
  cache.set(key, { at: Date.now(), quote });
  return quote;
}

export function createQuoteSource(): QuoteSource {
  return {
    async load(symbol: string, todayNairobi: string, fresh: boolean): Promise<CloseQuote> {
      const ticker = listingSymbol(symbol);
      if (/^[A-Z]{1,12}$/.test(ticker)) {
        const nse = await findNseShare(ticker);
        if (nse !== null) return loadNairobiQuote(ticker, todayNairobi, fresh);
      }
      const listed = await findNyseShare(ticker);
      if (listed !== null) return loadNyseQuote(ticker, listed.name, fresh);
      if (/^[A-Z]{1,12}$/.test(ticker)) return loadNairobiQuote(ticker, todayNairobi, fresh);
      throw new QuoteError("unknown_symbol", "That ticker is not on the NSE list.");
    },
  };
}

