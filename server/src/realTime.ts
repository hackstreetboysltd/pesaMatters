/**
 * True-time helpers. The host clock can be wrong in local/dev, so we
 * periodically sample a public UTC source and apply an offset.
 * Pattern matches internal-app lib/server/realTime.js.
 */

import { log } from "./logger.ts";

const STALE_MS = 10 * 60 * 1000;

let offsetMs = 0;
let lastSyncAt = 0;
let source: "host" | "network" = "host";
let inFlight: Promise<void> | null = null;
let loggedSkew = false;
let fetchImpl: typeof fetch = fetch;

export function portalTimeZone(): string {
  return process.env["PORTAL_TZ"] ?? "Africa/Nairobi";
}

async function fetchRemoteUtcMs(): Promise<number | null> {
  try {
    const res = await fetchImpl("https://cloudflare.com/cdn-cgi/trace", {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const text = await res.text();
      const match = text.match(/(?:^|\n)ts=([\d.]+)/);
      if (match !== null && match[1] !== undefined) {
        const ms = Number.parseFloat(match[1]) * 1000;
        if (Number.isFinite(ms) && ms > 0) return Math.round(ms);
      }
    }
  } catch {
    /* try Date header next */
  }

  try {
    const res = await fetchImpl("https://www.google.com/generate_204", {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
      redirect: "follow",
    });
    const hdr = res.headers.get("date");
    const ms = hdr !== null ? Date.parse(hdr) : NaN;
    if (Number.isFinite(ms)) return ms;
  } catch {
    /* fall through */
  }

  return null;
}

export async function syncRealTime(): Promise<void> {
  if (inFlight !== null) return inFlight;
  inFlight = (async () => {
    try {
      const remote = await fetchRemoteUtcMs();
      if (remote !== null) {
        const hostMs = Date.now();
        offsetMs = remote - hostMs;
        source = "network";
        if (!loggedSkew) {
          loggedSkew = true;
          log.info("real_time_synced", {
            source,
            skew_sec: Math.round(offsetMs / 1000),
          });
        }
      } else {
        source = "host";
      }
      lastSyncAt = Date.now();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export async function ensureRealTime(): Promise<void> {
  if (lastSyncAt === 0) {
    await syncRealTime();
    return;
  }
  if (Date.now() - lastSyncAt > STALE_MS) {
    syncRealTime().catch(() => {});
  }
}

export function realNowMs(): number {
  if (lastSyncAt === 0 || Date.now() - lastSyncAt > STALE_MS) {
    syncRealTime().catch(() => {});
  }
  return Date.now() + offsetMs;
}

export function realNowIso(): string {
  return new Date(realNowMs()).toISOString();
}

export function realNowDate(): Date {
  return new Date(realNowMs());
}

export function realTimeSource(): "host" | "network" {
  return source;
}

/** Test-only: inject fetch and clear sync state. */
export function resetRealTimeForTests(nextFetch: typeof fetch = fetch): void {
  fetchImpl = nextFetch;
  offsetMs = 0;
  lastSyncAt = 0;
  source = "host";
  inFlight = null;
  loggedSkew = false;
}
