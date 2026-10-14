/** Research store: per-question iteration state (seen URLs = the `seen` set of the
 *  plan's pseudocode; rounds = history; gaps/trust accumulation). In-memory only —
 *  TTL'd, capped, never crosses process (spec §6.4). */
import { randomBytes } from "node:crypto";
import type { SourceResult } from "../types.ts";

/** Stored cluster row (cross-validation matrix input; see tools/core mergeClusterRows). */
export interface ClusterRow {
  clusterId: string;
  size: number;
  memberUrls: string[];
  trustMix: Record<string, number>;
  topTitle: string;
  independentDomains?: number;
  dateRange?: [string, string];
}

export interface RoundRecord {
  round: number;
  queries: string[];
  newCount: number;
  removedDuplicates: number;
  urls: string[];
  targets: { ok: string[]; failed: string[] };
  trustMix: Record<string, number>;
  officialConfirmation: "found" | "none";
  at: number;
  /** Global corpus for verify_claims + matrix for research_state. */
  clusters?: ClusterRow[];
  results?: SourceResult[];
}

export interface ResearchState {
  id: string;
  question: string;
  maxRounds: number;
  rounds: RoundRecord[];
  seen: Set<string>;
  createdAt: number;
  lastTouched: number;
}

export interface ResearchStats {
  id: string;
  question: string;
  roundCount: number;
  maxRoundsReached: boolean;
  totalNew: number;
  totalDuplicates: number;
  totalSeen: number;
  targetsOk: string[];
  targetsFailed: string[];
  trustMix: Record<string, number>;
  officialConfirmation: "found" | "none";
  rounds: RoundRecord[];
}

export interface StoreOpts {
  ttlMs: number;
  maxConcurrent: number;
  now?: () => number;
}

export class ResearchStore {
  private readonly states = new Map<string, ResearchState>();
  private readonly ttlMs: number;
  private readonly maxConcurrent: number;
  private readonly now: () => number;

  constructor(opts: StoreOpts) {
    this.ttlMs = Math.max(1, opts.ttlMs);
    this.maxConcurrent = Math.max(1, opts.maxConcurrent);
    this.now = opts.now ?? Date.now;
  }

  private sweep(): void {
    const t = this.now();
    for (const [id, s] of this.states) {
      if (t - s.lastTouched > this.ttlMs) this.states.delete(id);
    }
  }

  create(question: string, maxRounds = 5): string {
    this.sweep();
    while (this.states.size >= this.maxConcurrent) {
      // evict oldest touched (Map preserves insertion; but lastTouched defines "oldest active")
      let oldestId: string | undefined;
      let oldest = Infinity;
      for (const [id, s] of this.states) {
        if (s.lastTouched < oldest) { oldest = s.lastTouched; oldestId = id; }
      }
      if (oldestId === undefined) break;
      this.states.delete(oldestId);
    }
    const id = `rs-${randomBytes(4).toString("hex")}`;
    const t = this.now();
    this.states.set(id, {
      id, question, maxRounds,
      rounds: [], seen: new Set(),
      createdAt: t, lastTouched: t,
    });
    return id;
  }

  private mustGet(id: string): ResearchState {
    this.sweep();
    const s = this.states.get(id);
    if (!s) throw new Error(`research not found (closed or expired): ${id}`);
    s.lastTouched = this.now();
    return s;
  }

  get(id: string): ResearchState {
    return this.mustGet(id);
  }

  /** Non-throwing existence check (TTL sweep first) — for tool-layer error envelopes. */
  has(id: string): boolean {
    this.sweep();
    return this.states.has(id);
  }

  /** Snapshot of seen URLs for the upcoming round (cross-round dedupe input). */
  newRound(id: string, queries?: string[]): { round: number; seen: Set<string>; maxRoundsReached: boolean } {
    const s = this.mustGet(id);
    void queries;
    return {
      round: s.rounds.length + 1,
      seen: new Set(s.seen),
      maxRoundsReached: s.rounds.length >= s.maxRounds,
    };
  }

  recordRound(id: string, data: Omit<RoundRecord, "round" | "at">): RoundRecord {
    const s = this.mustGet(id);
    const rec: RoundRecord = { round: s.rounds.length + 1, at: this.now(), ...data };
    s.rounds.push(rec);
    for (const u of data.urls) s.seen.add(u);
    return rec;
  }

  stats(id: string): ResearchStats {
    const s = this.mustGet(id);
    const trustMix: Record<string, number> = {};
    const targetsOk = new Set<string>();
    const targetsFailed = new Set<string>();
    let totalNew = 0;
    let totalDuplicates = 0;
    let official: "found" | "none" = "none";
    for (const r of s.rounds) {
      totalNew += r.newCount;
      totalDuplicates += r.removedDuplicates;
      for (const t of r.targets.ok) targetsOk.add(t);
      for (const t of r.targets.failed) targetsFailed.add(t);
      for (const [k, v] of Object.entries(r.trustMix)) trustMix[k] = (trustMix[k] ?? 0) + v;
      if (r.officialConfirmation === "found") official = "found";
    }
    return {
      id: s.id, question: s.question,
      roundCount: s.rounds.length,
      maxRoundsReached: s.rounds.length >= s.maxRounds,
      totalNew, totalDuplicates, totalSeen: s.seen.size,
      targetsOk: [...targetsOk], targetsFailed: [...targetsFailed],
      trustMix, officialConfirmation: official,
      rounds: s.rounds,
    };
  }

  close(id: string): ResearchStats {
    const stats = this.stats(id); // refresh + validate
    this.states.delete(id);
    return stats;
  }

  reset(id: string): void {
    const s = this.mustGet(id);
    s.rounds = [];
    s.seen.clear();
  }
}
