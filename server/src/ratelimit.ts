import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimiter = {
  limit(key: string): Promise<{ success: boolean }>;
};

const memory = new Map<string, { count: number; resetAt: number }>();

/** In-memory fallback for local dev when Upstash is unset. */
function memoryLimiter(): RateLimiter {
  return {
    async limit(key: string) {
      const now = Date.now();
      const slot = memory.get(key);
      if (slot === undefined || slot.resetAt < now) {
        memory.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
        return { success: true };
      }
      slot.count += 1;
      return { success: slot.count <= 20 };
    },
  };
}

export function createRateLimiter(url: string | null, token: string | null): RateLimiter {
  if (url === null || token === null) return memoryLimiter();
  const redis = new Redis({ url, token });
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, "15 m"),
    prefix: "pesamatters:login",
  });
  return {
    async limit(key: string) {
      const result = await limiter.limit(key);
      return { success: result.success };
    },
  };
}
