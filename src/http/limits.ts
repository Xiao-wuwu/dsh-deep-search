/** Local token bucket + engine cooldown registry (learned from modsearch's quota failover). */

export interface Clock {
  now: () => number;
}

/** Fixed-window rate limiter: up to `perMinute` calls per rolling 60s. */
export class RateBucket {
  private stamps: number[] = [];
  private readonly perMinute: number;
  private readonly now: () => number;

  constructor(opts: { perMinute: number } & Partial<Clock>) {
    this.perMinute = Math.max(1, Math.trunc(opts.perMinute));
    this.now = opts.now ?? Date.now;
  }

  tryConsume(): boolean {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < 60_000);
    if (this.stamps.length >= this.perMinute) return false;
    this.stamps.push(t);
    return true;
  }

  /** ms until the next slot frees (0 when available now). */
  retryAfterMs(): number {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < 60_000);
    if (this.stamps.length < this.perMinute) return 0;
    return Math.max(0, 60_000 - (t - this.stamps[0]!));
  }
}

/** Engines that hit quota/429 move to the BACK of the chain until they recover — never dropped. */
export class Cooldown {
  private readonly until = new Map<string, number>();
  private readonly now: () => number;

  constructor(opts: Partial<Clock> = {}) {
    this.now = opts.now ?? Date.now;
  }

  mark(id: string, minutes: number): void {
    this.until.set(id, this.now() + Math.max(1, minutes) * 60_000);
  }

  touched(id: string): boolean {
    const u = this.until.get(id);
    if (u === undefined) return false;
    if (this.now() >= u) {
      this.until.delete(id);
      return false;
    }
    return true;
  }

  list(): { id: string; untilMs: number }[] {
    const t = this.now();
    const rows: { id: string; untilMs: number }[] = [];
    for (const [id, until] of [...this.until]) {
      if (t >= until) this.until.delete(id);
      else rows.push({ id, untilMs: until });
    }
    return rows.sort((a, b) => a.untilMs - b.untilMs);
  }

  clear(): void {
    this.until.clear();
  }
}
