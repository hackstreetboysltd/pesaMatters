import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.ts";

export type ListedShare = {
  symbol: string;
  name: string;
};

const here = dirname(fileURLToPath(import.meta.url));
const NYSE_SNAPSHOT = join(here, "..", "data", "nyse.json");
const NSE_SNAPSHOT = join(here, "..", "data", "nse.json");
const NYSE_DIRECTORY = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt";
const NSE_DIRECTORY = "https://afx.kwayisi.org/nse/";
const TTL_MS = 12 * 60 * 60 * 1000;

/** Warrants, units, and rights are not shares you hold like common stock. */
const SKIP_SUFFIX = /\.(?:W|U|R|WS)$/;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

/**
 * Nasdaq Trader's free other-listed file. Exchange `N` is the NYSE.
 * Test issues and ETFs are left out.
 */
export function parseNyseDirectory(text: string): ListedShare[] {
  const rows: ListedShare[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0 || line.startsWith("ACT Symbol") || line.startsWith("File Creation Time")) continue;
    const parts = line.split("|");
    if (parts.length < 7) continue;
    const symbol = parts[0] ?? "";
    const rawName = parts[1] ?? "";
    const exchange = parts[2];
    const etf = parts[4];
    const test = parts[6];
    if (exchange !== "N" || test !== "N" || etf === "Y") continue;
    if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol) || SKIP_SUFFIX.test(symbol)) continue;
    const name = rawName.trim().replace(/\s+/g, " ").slice(0, 80);
    if (name.length === 0) continue;
    rows.push({ symbol, name });
  }
  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return rows;
}

/**
 * Free Kwayisi NSE board. Title attributes carry the company name;
 * ticker-only anchors are ignored. Sorted by name for the buy menu.
 */
export function parseNseDirectory(html: string): ListedShare[] {
  const names = new Map<string, string>();
  for (const match of html.matchAll(/\/nse\/([a-z0-9]+)\.html"[^>]*title="([^"]+)"/gi)) {
    const symbol = match[1]?.toUpperCase() ?? "";
    const name = decodeEntities((match[2] ?? "").replace(/\s+/g, " ").trim()).slice(0, 80);
    if (!/^[A-Z]{1,12}$/.test(symbol) || name.length === 0) continue;
    if (name.toUpperCase() === symbol) continue;
    names.set(symbol, name);
  }
  return [...names.entries()]
    .map(([symbol, name]) => ({ symbol, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseSnapshot(raw: unknown, symbolOk: (symbol: string) => boolean): ListedShare[] {
  if (!Array.isArray(raw)) return [];
  const rows: ListedShare[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const symbol = (item as { symbol?: unknown }).symbol;
    const name = (item as { name?: unknown }).name;
    if (typeof symbol !== "string" || typeof name !== "string") continue;
    if (!symbolOk(symbol)) continue;
    const clean = name.trim().slice(0, 80);
    if (clean.length === 0) continue;
    rows.push({ symbol, name: clean });
  }
  return rows;
}

export function parseNyseSnapshot(raw: unknown): ListedShare[] {
  return parseSnapshot(raw, (symbol) => /^[A-Z][A-Z0-9.]{0,9}$/.test(symbol));
}

export function parseNseSnapshot(raw: unknown): ListedShare[] {
  const rows = parseSnapshot(raw, (symbol) => /^[A-Z]{1,12}$/.test(symbol));
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

function readNyseSnapshot(): ListedShare[] {
  const raw: unknown = JSON.parse(readFileSync(NYSE_SNAPSHOT, "utf8"));
  return parseNyseSnapshot(raw);
}

function readNseSnapshot(): ListedShare[] {
  const raw: unknown = JSON.parse(readFileSync(NSE_SNAPSHOT, "utf8"));
  return parseNseSnapshot(raw);
}

type Cache = { at: number; rows: ListedShare[] };
let nyseCache: Cache | null = null;
let nseCache: Cache | null = null;

export function clearSymbolCache(): void {
  nyseCache = null;
  nseCache = null;
}

async function fetchText(url: string, accept: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
      headers: { Accept: accept, "User-Agent": "Mozilla/5.0 (compatible; pesaMatters/1.0)" },
    });
    if (!response.ok) throw new Error("directory status");
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error("directory size");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** NYSE common shares. Kept for marks on any New York lots already on the books. */
export async function nyseShares(fresh = false): Promise<ListedShare[]> {
  if (!fresh && nyseCache !== null && Date.now() - nyseCache.at < TTL_MS) return nyseCache.rows;
  try {
    const rows = parseNyseDirectory(await fetchText(NYSE_DIRECTORY, "text/plain"));
    if (rows.length < 500) throw new Error("short directory");
    nyseCache = { at: Date.now(), rows };
    return rows;
  } catch (error) {
    log.warn("nyse_directory_fallback", { name: error instanceof Error ? error.name : "unknown" });
    if (nyseCache !== null) return nyseCache.rows;
    const rows = readNyseSnapshot();
    nyseCache = { at: Date.now(), rows };
    return rows;
  }
}

/**
 * Nairobi shares Kingdom Securities can trade. The live Kwayisi board is preferred;
 * the committed snapshot is the fallback.
 */
export async function nseShares(fresh = false): Promise<ListedShare[]> {
  if (!fresh && nseCache !== null && Date.now() - nseCache.at < TTL_MS) return nseCache.rows;
  try {
    const rows = parseNseDirectory(await fetchText(NSE_DIRECTORY, "text/html, */*"));
    if (rows.length < 30) throw new Error("short directory");
    nseCache = { at: Date.now(), rows };
    return rows;
  } catch (error) {
    log.warn("nse_directory_fallback", { name: error instanceof Error ? error.name : "unknown" });
    if (nseCache !== null) return nseCache.rows;
    const rows = readNseSnapshot();
    nseCache = { at: Date.now(), rows };
    return rows;
  }
}

export async function findNyseShare(symbol: string): Promise<ListedShare | null> {
  const rows = await nyseShares();
  return rows.find((row) => row.symbol === symbol) ?? null;
}

export async function findNseShare(symbol: string): Promise<ListedShare | null> {
  const rows = await nseShares();
  return rows.find((row) => row.symbol === symbol) ?? null;
}
