/** Tool core (pure orchestrator, no DSH runtime imports): deep_search / research_state /
 *  verify_claims business logic. The defineTool shells in src/tools.ts wrap these.
 *  Contract: never throws for any input — every failure becomes a structured envelope. */
import { HttpError } from "../http/client.ts";
import { QuotaError, type Engine } from "../engines/types.ts";
import type { Platform } from "../platforms/registry.ts";
import type { BestEffortPlatform } from "../platforms/besteffort.ts";
import type { TierResult } from "../platforms/parsers.ts";
import { dedupeUrls } from "../pipeline/dedupe.ts";
import { clusterHits, type Cluster } from "../pipeline/cluster.ts";
import { extractMeta } from "../pipeline/extract.ts";
import { gradeTrust, deriveFlags } from "../pipeline/trust.ts";
import { budgetEnvelope } from "../pipeline/budget.ts";
import { officialConfirmation, buildHint } from "../pipeline/envelope.ts";
import { buildDoctor } from "../doctor.ts";
import { verifyClaims } from "../verify/claims.ts";
import type { ResearchStore, RoundRecord, ClusterRow } from "../research/store.ts";
import type { Cooldown } from "../http/limits.ts";
import type { CacheStore } from "../http/cache.ts";
import type { Config } from "../config.ts";
import type { Gap, SourceResult, TrustSpec } from "../types.ts";

export interface ToolCtx {
  cfg: Config;
  store: ResearchStore;
  cooldown: Cooldown;
  cache: CacheStore;
  trustSpec: TrustSpec;
  engines: Engine[];
  platforms: Platform[];
  disabled: { engines: { id: string; reason: string }[]; platforms: { id: string; reason: string }[] };
  maxConcurrentResearch: number;
  researchTtlMs: number;
}

type RawHit = { title: string; url: string; snippet: string; date?: string; author?: string; votes?: number; comments?: number };
type DeepEnv = Record<string, unknown> & { ok: boolean };

function emptyEnv(over: Partial<DeepEnv> = {}): DeepEnv {
  return {
    ok: true,
    researchId: "",
    round: 0,
    maxRoundsReached: false,
    newCount: 0,
    skippedDuplicates: 0,
    results: [],
    clusters: [],
    gaps: [],
    officialConfirmation: { status: "none", evidence: [] },
    hint: { coverage: "", suggest: [] },
    stats: { elapsedMs: 0, queriesRun: 0, perTarget: {} },
    ...over,
  };
}

const ANNOUNCE_RE = /发布|开源|上线|推出|released|release|launch|open.?source|weights|announce|模型/i;
const FRESH_RE = /最新|最近|今天|本周|latest|recent|this week|today/i;

interface QuerySpec { q: string; target?: string; timeRange?: string; maxResults?: number }

export function normalizeQueries(raw: unknown): QuerySpec[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "queries must be a non-empty array";
  const specs: QuerySpec[] = [];
  for (const item of raw) {
    if (typeof item === "string") { if (item.trim()) specs.push({ q: item.trim() }); continue; }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const q = typeof o.q === "string" ? o.q.trim() : typeof o.query === "string" ? (o.query as string).trim() : "";
      if (!q) return `query item without text: ${JSON.stringify(item).slice(0, 80)}`;
      specs.push({
        q,
        ...(typeof o.target === "string" && o.target ? { target: o.target } : {}),
        ...(typeof o.timeRange === "string" && o.timeRange ? { timeRange: o.timeRange } : {}),
        ...(typeof o.maxResults === "number" ? { maxResults: o.maxResults } : {}),
      });
      continue;
    }
    return `invalid query item type: ${typeof item}`;
  }
  if (specs.length === 0) return "no usable queries";
  return specs;
}

/** tiny fixed-size concurrent pool */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i]!);
    }
  }));
}

function toSourceResults(hits: RawHit[], target: string, trust: TrustSpec): SourceResult[] {
  return hits.map((h) => {
    const row: SourceResult = {
      title: h.title, url: h.url, snippet: h.snippet.slice(0, 400), target,
      trustRank: "D", flags: [],
      ...(h.date ? { date: h.date } : {}),
      ...(h.author ? { author: h.author } : {}),
      ...(h.votes !== undefined ? { votes: h.votes } : {}),
      ...(h.comments !== undefined ? { comments: h.comments } : {}),
    };
    row.trustRank = gradeTrust(row, trust);
    row.extracted = extractMeta(`${h.title} ${h.snippet} ${h.date ?? ""}${h.author ? ` @${h.author}` : ""}`);
    return row;
  });
}

function classifyError(err: unknown): { status: Gap["status"]; reason: string; quota: boolean } {
  if (err instanceof QuotaError || (err instanceof HttpError && err.isQuota)) {
    return { status: "unavailable", reason: err.message.slice(0, 200), quota: true };
  }
  const e = err as (Error & { status?: number });
  if (e?.status === 429 || e?.status === 402) return { status: "unavailable", reason: String(e.message).slice(0, 200), quota: true };
  if (e?.name === "AbortError") return { status: "failed", reason: "cancelled", quota: false };
  return { status: "failed", reason: String(e?.message ?? err).slice(0, 200), quota: false };
}

/* =================== deep_search =================== */

export interface DeepSearchArgs {
  question?: string;
  mode?: string;
  queries?: unknown[];
  researchId?: string;
  maxResultsPerQuery?: number;
  budgetChars?: number;
  doctor?: boolean;
  signal?: AbortSignal;
}

export async function runDeepSearch(args: DeepSearchArgs, ctx: ToolCtx): Promise<DeepEnv> {
  const started = Date.now();
  try {
    if (args.doctor) {
      const report = buildDoctor(ctx.cfg, {
        engines: { active: ctx.engines, disabled: ctx.disabled.engines },
        platforms: { active: ctx.platforms, disabled: ctx.disabled.platforms },
        cooldown: ctx.cooldown,
      });
      return emptyEnv({ doctor: report as unknown as Record<string, unknown>, hint: { coverage: "doctor（未检索）", suggest: report.fixes } });
    }

    const specsOrErr = normalizeQueries(args.queries);
    if (typeof specsOrErr === "string") {
      return {
        ...emptyEnv(),
        ok: false,
        error: { code: "INVALID_ARGS", message: specsOrErr, hint: '示例：{"queries":["qwen4 发布",{"q":"qwen4","target":"huggingface","timeRange":"week"}]}' },
      };
    }
    const specs = specsOrErr.slice(0, ctx.cfg.limits.maxQueriesPerCall);
    const question = (typeof args.question === "string" && args.question.trim()) || specs[0]!.q;

    // research lifecycle
    let researchId = args.researchId ?? "";
    if (researchId) {
      try { ctx.store.get(researchId); } catch {
        return { ...emptyEnv(), ok: false, error: { code: "RESEARCH_NOT_FOUND", message: `research not found (closed or expired): ${researchId}`, hint: "omit researchId to start a new one" } };
      }
    } else {
      researchId = ctx.store.create(question, ctx.cfg.limits.maxRounds);
    }
    const nr = ctx.store.newRound(researchId);

    const perTarget: Record<string, { hits: number; ms: number; error?: string }> = {};
    const gaps: Gap[] = [];
    const rawRows: SourceResult[] = [];

    const runChannel = async (
      kind: "engine" | "platform", id: string,
      run: () => Promise<{ hits: RawHit[]; tier?: TierResult }>,
    ): Promise<number> => {
      const t0 = Date.now();
      const slot = perTarget[id] ?? { hits: 0, ms: 0 };
      try {
        const { hits, tier } = await run();
        slot.hits += hits.length;
        perTarget[id] = { ...slot, ms: (perTarget[id]?.ms ?? 0) + (Date.now() - t0) };
        rawRows.push(...toSourceResults(hits, id, ctx.trustSpec));
        if (tier && tier.status !== "ok") {
          gaps.push({
            target: id, reason: (tier.note ?? String(tier.status)).slice(0, 200),
            status: tier.status === "failed" ? "failed" : tier.status,
            ...(id === "x" ? { requestedTarget: "x", actualTarget: hits.length > 0 ? "x" : "web" } : {}),
          });
        }
        return hits.length;
      } catch (err) {
        const c = classifyError(err);
        perTarget[id] = { ...slot, ms: (perTarget[id]?.ms ?? 0) + (Date.now() - t0), error: c.reason };
        if (c.quota && ctx.cfg.cooldown.enabled) ctx.cooldown.mark(id, ctx.cfg.cooldown.minutes);
        gaps.push({
          target: id, reason: c.reason, status: c.status,
          ...(id === "x" || ctx.cfg.platforms.enabled.includes(id) ? { requestedTarget: id, actualTarget: "web" } : {}),
        });
        return 0;
      }
    };

    await pool(specs, ctx.cfg.limits.concurrency, async (spec) => {
      const maxResults = spec.maxResults ?? args.maxResultsPerQuery ?? 8;
      const opts = { timeRange: spec.timeRange, maxResults, signal: args.signal };

      if (spec.target) {
        const eng = ctx.engines.find((e) => e.id === spec.target);
        const plat = ctx.platforms.find((p) => p.id === spec.target);
        if (!eng && !plat) {
          gaps.push({ target: spec.target, reason: `unknown or disabled target: ${spec.target} (run doctor)`, status: "failed" });
          return;
        }
        if (plat && typeof (plat as BestEffortPlatform).searchWithStatus === "function") {
          const be = plat as BestEffortPlatform;
          await runChannel("platform", plat.id, async () => {
            const r = await be.searchWithStatus(spec.q, opts);
            return { hits: r.hits, tier: r };
          });
        } else {
          const ch = eng ?? plat!;
          await runChannel(eng ? "engine" : "platform", ch.id, async () => ({ hits: await ch.search(spec.q, opts) }));
        }
        return;
      }
      // no explicit target: sequential engine fallback, stop at first engine with hits
      if (ctx.engines.length === 0) {
        gaps.push({ target: "engines", reason: "no engines active (all cooling?) — run doctor", status: "unavailable" });
        return;
      }
      for (const eng of ctx.engines) {
        const got = await runChannel("engine", eng.id, async () => ({ hits: await eng.search(spec.q, opts) }));
        if (got > 0) return;
      }
    });

    const { hits: fresh, removed } = dedupeUrls(rawRows, nr.seen);
    const clusters = clusterHits(fresh);
    deriveFlags(fresh, clusters, ctx.trustSpec, {
      expectsOfficial: ANNOUNCE_RE.test(question),
      wantsFresh: FRESH_RE.test(question),
    });

    const budget = Math.max(500, Math.min(args.budgetChars ?? ctx.cfg.limits.budgetChars, 20000));
    const { kept, omittedCount, reason } = budgetEnvelope(fresh, { budgetChars: budget });

    const official = officialConfirmation(fresh, question);
    const okTargets = Object.keys(perTarget).filter((id) => !perTarget[id]!.error);
    const hint = buildHint({ ok: okTargets, failed: gaps.map((g) => ({ id: g.target, reason: g.reason })), newCount: fresh.length });

    const trustMix: Record<string, number> = {};
    for (const h of fresh) trustMix[h.trustRank] = (trustMix[h.trustRank] ?? 0) + 1;

    ctx.store.recordRound(researchId, {
      queries: specs.map((s) => s.q),
      newCount: fresh.length,
      removedDuplicates: removed,
      urls: fresh.map((h) => h.url),
      targets: { ok: okTargets, failed: gaps.map((g) => g.target) },
      trustMix,
      officialConfirmation: official.status,
      clusters: clusters.map(clusterRow),
      results: fresh,
    });

    const env = emptyEnv({
      researchId,
      round: nr.round,
      maxRoundsReached: nr.maxRoundsReached,
      newCount: fresh.length,
      skippedDuplicates: removed,
      results: kept,
      clusters: clusters.map(clusterRow),
      gaps,
      officialConfirmation: official,
      hint,
      stats: { elapsedMs: Date.now() - started, queriesRun: specs.length, perTarget },
      ...(omittedCount > 0 ? { omitted: { count: omittedCount, reason: reason === "none" ? "budgetChars" : reason } } : {}),
    });
    return env;
  } catch (err) {
    return { ...emptyEnv(), ok: false, error: { code: "INTERNAL", message: String((err as Error)?.message ?? err).slice(0, 300) } };
  }
}

function clusterRow(c: Cluster): ClusterRow {
  return {
    clusterId: c.clusterId, size: c.size, memberUrls: c.memberIds, trustMix: c.trustMix,
    topTitle: c.topTitle, independentDomains: c.independentDomains,
    ...(c.dateRange ? { dateRange: c.dateRange } : {}),
  };
}

/* =================== research_state =================== */

export interface ResearchStateArgs { researchId: string; action: "summary" | "close" | "reset" }

export function runResearchState(args: ResearchStateArgs, ctx: ToolCtx): Record<string, unknown> {
  const id = args.researchId;
  const invalidAction = !["summary", "close", "reset"].includes(args.action);
  if (!ctx.store.has(id)) {
    return {
      ok: false, researchId: id, action: args.action, roundCount: 0, maxRoundsReached: false,
      totalNew: 0, totalDuplicates: 0, totalSeen: 0, targetsOk: [], targetsFailed: [], trustMix: {},
      officialConfirmation: "none", clusters: [], rounds: [],
      error: { code: "RESEARCH_NOT_FOUND", message: `research not found (closed or expired): ${id}`, hint: "omit researchId to start a new one" },
    };
  }
  try {
    if (invalidAction) {
      return { ok: false, researchId: id, action: args.action ?? "", roundCount: 0, maxRoundsReached: false, totalNew: 0, totalDuplicates: 0, totalSeen: 0, targetsOk: [], targetsFailed: [], trustMix: {}, officialConfirmation: "none", clusters: [], rounds: [], error: { code: "INVALID_ACTION", message: `action must be summary|close|reset, got ${String(args.action)}` } };
    }
    if (args.action === "reset") {
      ctx.store.reset(id);
      return { ok: true, researchId: id, action: "reset", ...summaryBody(ctx.store.stats(id), []) };
    }
    if (args.action === "close") {
      const s = ctx.store.close(id);
      return { ok: true, researchId: id, action: "close", released: true, ...summaryBody(s, []) };
    }
    const state = ctx.store.get(id);
    const matrix = mergeClusterRows(state.rounds);
    return { ok: true, researchId: id, action: "summary", ...summaryBody(ctx.store.stats(id), matrix) };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    return {
      ok: false, researchId: id, action: args.action, roundCount: 0, maxRoundsReached: false,
      totalNew: 0, totalDuplicates: 0, totalSeen: 0, targetsOk: [], targetsFailed: [], trustMix: {},
      officialConfirmation: "none", clusters: [], rounds: [],
      error: { code: /not found/i.test(msg) ? "RESEARCH_NOT_FOUND" : "INTERNAL", message: msg.slice(0, 300) },
    };
  }
}

interface ClusterRowShape { clusterId: string; size: number; memberUrls: string[]; trustMix: Record<string, number>; topTitle: string; independentDomains?: number; dateRange?: [string, string] }

function summaryBody(stats: ReturnType<ResearchStore["stats"]>, clusters: Record<string, unknown>[]): Record<string, unknown> {
  return {
    question: stats.question,
    roundCount: stats.roundCount,
    maxRoundsReached: stats.maxRoundsReached,
    totalNew: stats.totalNew,
    totalDuplicates: stats.totalDuplicates,
    totalSeen: stats.totalSeen,
    targetsOk: stats.targetsOk,
    targetsFailed: stats.targetsFailed,
    trustMix: stats.trustMix,
    officialConfirmation: stats.officialConfirmation,
    clusters,
    rounds: stats.rounds.map((r: RoundRecord) => ({
      round: r.round, queries: r.queries, newCount: r.newCount, removedDuplicates: r.removedDuplicates,
      targets: r.targets, trustMix: r.trustMix, officialConfirmation: r.officialConfirmation, at: r.at,
    })),
  };
}

/** Union-find over stored round clusters by shared URLs → global cross-validation matrix. */
export function mergeClusterRows(rounds: { clusters?: ClusterRowShape[] }[]): Record<string, unknown>[] {
  const all = rounds.flatMap((r) => r.clusters ?? []);
  if (all.length === 0) return [];
  const urlToIdx = new Map<string, number>();
  const parent = all.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const union = (x: number, y: number): void => { const rx = find(x), ry = find(y); if (rx !== ry) parent[ry] = rx; };
  all.forEach((c, i) => {
    for (const u of c.memberUrls) {
      const p = urlToIdx.get(u);
      if (p === undefined) urlToIdx.set(u, i);
      else union(i, p);
    }
  });
  const groups = new Map<number, ClusterRowShape[]>();
  all.forEach((c, i) => {
    const r = find(i);
    const g = groups.get(r) ?? [];
    g.push(c);
    groups.set(r, g);
  });
  const out: Record<string, unknown>[] = [];
  let n = 0;
  for (const g of groups.values()) {
    const urls = [...new Set(g.flatMap((c) => c.memberUrls))];
    const trustMix: Record<string, number> = {};
    for (const c of g) for (const [k, v] of Object.entries(c.trustMix)) trustMix[k] = (trustMix[k] ?? 0) + v;
    const dates = g.flatMap((c) => c.dateRange ?? []).sort();
    const domains = countDomains(urls);
    out.push({
      clusterId: `x${n++}`, size: urls.length, memberUrls: urls, trustMix,
      topTitle: [...g].sort((a, b) => b.size - a.size)[0]!.topTitle,
      independentDomains: domains,
      ...(dates.length ? { dateRange: [dates[0], dates[dates.length - 1]] } : {}),
    });
  }
  return out.sort((a, b) => (b.size as number) - (a.size as number));
}

function countDomains(urls: string[]): number {
  const set = new Set<string>();
  for (const u of urls) { try { set.add(new URL(u).hostname.replace(/^www\./, "")); } catch { /* skip */ } }
  return set.size;
}

/* =================== verify_claims =================== */

export interface VerifyArgs { researchId: string; claims: { id?: string; text: string }[] }

export function runVerifyTool(args: VerifyArgs, ctx: ToolCtx): Record<string, unknown> {
  try {
    const state = ctx.store.get(args.researchId);
    if (!Array.isArray(args.claims) || args.claims.length === 0) {
      return { ok: false, researchId: args.researchId, results: [], error: { code: "INVALID_ARGS", message: "claims must be a non-empty array of {text}" } };
    }
    const corpus = state.rounds.flatMap((r) => r.results ?? []);
    const claims = args.claims.slice(0, 10).map((c, i) => ({ id: c.id ?? `k${i}`, text: String(c.text ?? "") }));
    const results = verifyClaims(ctx.store, args.researchId, claims, corpus);
    return { ok: true, researchId: args.researchId, results };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    return { ok: false, researchId: args.researchId, results: [], error: { code: /not found/i.test(msg) ? "RESEARCH_NOT_FOUND" : "INTERNAL", message: msg.slice(0, 300) } };
  }
}
