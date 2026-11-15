// Fixed-window request counter per key, in memory. One API process per deployment, so a shared store is not
// needed yet; a second replica would need Postgres or Redis behind the same interface.

export interface RateLimiter {
  /** Counts one request. Returns the seconds to wait when the key is over its limit, else 0. */
  hit(key: string, now?: number): number;
}

const MAX_KEYS = 10_000;

export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key, now = Date.now()) {
      if (windows.size >= MAX_KEYS) {
        for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
        // Still full of live keys: drop the oldest tenth, so memory stays bounded and the sweep stays rare.
        for (const k of windows.keys()) {
          if (windows.size < MAX_KEYS * 0.9) break;
          windows.delete(k);
        }
      }
      const current = windows.get(key);
      if (current === undefined || now - current.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return 0;
      }
      current.count += 1;
      return current.count > limit ? Math.ceil((current.start + windowMs - now) / 1000) : 0;
    },
  };
}
