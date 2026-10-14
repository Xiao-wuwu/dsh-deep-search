/** In-memory LRU with TTL. Injectable clock so tests control time. */

export interface CacheStoreOptions {
  lruSize: number;
  ttlMs: number;
  /** Clock seam (defaults to Date.now). */
  now?: () => number;
}

export class CacheStore {
  private readonly map = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly lruSize: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: CacheStoreOptions) {
    this.lruSize = Math.max(1, opts.lruSize);
    this.ttlMs = opts.ttlMs;
    this.now = opts.now ?? Date.now;
  }

  get(key: string): unknown | undefined {
    const hit = this.map.get(key);
    if (hit === undefined) return undefined;
    if (this.now() >= hit.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // touch: move to most-recent
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: unknown): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.map.size > this.lruSize) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}
