import type { Db } from "./db.ts";
import { log } from "./logger.ts";
import { QuoteError, msUntilNextCloseTick, nairobiDate, type QuoteSource } from "./quotes.ts";
import { appendEntry, listInvestments } from "./store.ts";

export type RefreshResult = {
  updated: number;
  skipped: number;
  failed: string[];
};

/**
 * Write yesterday's published close onto each holding.
 * A price change goes through the ledger. A prior-close fill that does not
 * move the price is display data only.
 */
export async function refreshCloses(pool: Db, source: QuoteSource, now = new Date()): Promise<RefreshResult> {
  const today = nairobiDate(now);
  const holdings = await listInvestments(pool);
  const seen = new Map<string, Awaited<ReturnType<QuoteSource["load"]>>>();
  let updated = 0;
  let skipped = 0;
  const failed: string[] = [];

  for (const holding of holdings) {
    let quote = seen.get(holding.symbol);
    if (quote === undefined) {
      try {
        quote = await source.load(holding.symbol, today, true);
        seen.set(holding.symbol, quote);
      } catch (error) {
        failed.push(holding.symbol);
        const code = error instanceof QuoteError ? error.code : "quote_unavailable";
        log.warn("close_lookup_failed", { symbol: holding.symbol, code });
        continue;
      }
    }
    const latest = quote.closes[quote.closes.length - 1];
    if (latest === undefined) {
      failed.push(holding.symbol);
      continue;
    }
    const prior = quote.closes.length >= 2 ? quote.closes[quote.closes.length - 2] : undefined;
    const priorCents = prior?.closeCents ?? null;
    const priorSession = prior?.sessionDate ?? null;
    const sameClose = holding.closeSession === latest.sessionDate && holding.priceCents === latest.closeCents;
    const samePrior = holding.priorCloseCents === priorCents && holding.priorSession === priorSession;
    if (sameClose && samePrior) {
      skipped += 1;
      continue;
    }
    if (sameClose) {
      await pool.query(
        "UPDATE investments SET prior_close_cents = ?, prior_session = ? WHERE id = ?",
        [priorCents, priorSession, holding.id],
      );
      updated += 1;
      continue;
    }
    const payload: Record<string, string | number | null> = {
      investmentId: holding.id,
      priceCents: latest.closeCents,
      sessionDate: latest.sessionDate,
      priorCloseCents: priorCents,
      priorSession,
    };
    await appendEntry(pool, "mark", payload, now);
    updated += 1;
  }

  log.info("close_refresh", { updated, skipped, failed: failed.length });
  return { updated, skipped, failed };
}

export function startCloseScheduler(pool: Db, source: QuoteSource): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const arm = (): void => {
    if (stopped) return;
    const wait = msUntilNextCloseTick(new Date());
    timer = setTimeout(() => {
      void refreshCloses(pool, source)
        .catch((error: unknown) => {
          log.error("close_refresh_failed", { name: error instanceof Error ? error.name : "unknown" });
        })
        .finally(() => {
          arm();
        });
    }, wait);
    timer.unref();
  };

  void refreshCloses(pool, source).catch((error: unknown) => {
    log.error("close_refresh_failed", { name: error instanceof Error ? error.name : "unknown" });
  });
  arm();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
