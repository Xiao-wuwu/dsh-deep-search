import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { runDeepSearch, runResearchState, runVerifyTool } from "../src/tools/core.ts";
import { DEEP_SEARCH_OUTPUT_FIELDS, RESEARCH_STATE_OUTPUT_FIELDS, VERIFY_OUTPUT_FIELDS } from "../src/tools/schemas.ts";
import { ResearchStore } from "../src/research/store.ts";
import { Cooldown } from "../src/http/limits.ts";
import { CacheStore } from "../src/http/cache.ts";
import type { Config } from "../src/config.ts";
import type { Engine } from "../src/engines/types.ts";
import type { Platform } from "../src/platforms/registry.ts";

const trust = JSON.parse(readFileSync(new URL("../catalog/trust.v1.json", import.meta.url), "utf8"));
const cfg: Config = {
  engines: { enabled: ["bing", "tavily"], searxngInstances: [], proxyByTarget: {} },
  platforms: { enabled: ["github"], custom: [], xEndpoint: "" },
  limits: { concurrency: 4, perTargetConcurrency: 2, queryTimeoutMs: 15000, maxQueriesPerCall: 24, maxRounds: 5, budgetChars: 9000, rateLimitPerMinute: 60 },
  cooldown: { enabled: true, minutes: 15 },
  cache: { lruSize: 50, ttlMinutes: 10, persist: false },
  trust: { extraOfficialDomains: [], extraOfficialAccounts: [], extraFarmPatterns: [] },
  promptInjection: true, researchTtlMinutes: 120,
};

function fakeEngine(id: string, impl: Engine["search"]): Engine {
  return { id, timeRange: true, search: impl };
}

function mkCtx(opts: { engines?: Engine[]; platforms?: Platform[] } = {}) {
  const engines = opts.engines ?? [];
  const platforms = opts.platforms ?? [];
  const ctx = {
    cfg,
    store: new ResearchStore({ ttlMs: 120_000, maxConcurrent: 20 }),
    cooldown: new Cooldown(),
    cache: new CacheStore({ lruSize: 100, ttlMs: 60_000 }),
    trustSpec: trust,
    engines,
    platforms,
    disabled: { engines: [{ id: "tavily", reason: "missing credential for tavily (ref: TAVILY_API_KEY)" }], platforms: [] as { id: string; reason: string }[] },
    xChannel: { configured: false, status: "best-effort" as const },
    maxConcurrentResearch: 20,
    researchTtlMs: 120_000,
  };
  return ctx;
}

function sampleEngine(): Engine {
  return fakeEngine("bing", async () => [
    { title: "Qwen4-Max released", url: "https://qwen.ai/blog/qwen4", snippet: "official announcement of Qwen4-Max release", date: "2026-10-10" },
    { title: "rumor thread", url: "https://reddit.com/r/llm/comments/abc", snippet: "people speculating about qwen4", author: "devX" },
  ]);
}

/* ---------- deep_search ---------- */

test("deep_search: results+clusters+stats present; schema fields all declared", async () => {
  const ctx = mkCtx({ engines: [sampleEngine()] });
  const env = await runDeepSearch({ queries: ["qwen4 max 发布"] }, ctx);
  assert.equal(env.ok, true);
  assert.equal(env.results.length, 2);
  assert.ok(env.results[0]!.trustRank === "A");
  // envelope ships only multi-source clusters; singletons are omitted (full matrix in store)
  assert.ok(env.clusters.every((c: { size: number }) => c.size >= 2));
  assert.ok(env.stats.elapsedMs >= 0);
  // contract: no undeclared key leaks into the envelope (zhihu v1.4.0 guard)
  for (const k of Object.keys(env)) {
    assert.ok(DEEP_SEARCH_OUTPUT_FIELDS.has(k), `undeclared envelope key: ${k}`);
  }
  for (const r of env.results) {
    for (const k of Object.keys(r)) {
      assert.ok(DEEP_SEARCH_OUTPUT_FIELDS.has(`result:${k}`), `undeclared result field: ${k}`);
    }
  }
});

test("deep_search: researchId creates + rounds dedupe across calls", async () => {
  const ctx = mkCtx({ engines: [sampleEngine()] });
  const e1 = await runDeepSearch({ question: "qwen4 发布了吗", queries: ["qwen4"] }, ctx);
  assert.equal(e1.round, 1);
  const e2 = await runDeepSearch({ researchId: e1.researchId, queries: ["qwen4 发布"] }, ctx);
  assert.equal(e2.round, 2);
  assert.equal(e2.newCount, 0, "same URLs seen → all deduped");
  assert.ok(e2.skippedDuplicates >= 2);
});

test("deep_search: per-query target routing + gap on unknown target", async () => {
  const ctx = mkCtx({ engines: [sampleEngine()] });
  const env = await runDeepSearch({
    queries: [{ q: "x", target: "bing" }, { q: "y", target: "nonexistent-target" }],
  }, ctx);
  assert.ok(env.results.every((r) => r.target === "bing"));
  const g = env.gaps.find((x) => x.target === "nonexistent-target");
  assert.ok(g && /unknown/i.test(g.reason));
});

test("deep_search: engine failure → gap, never throws", async () => {
  const boom = fakeEngine("bing", async () => { throw new Error("network down"); });
  const ctx = mkCtx({ engines: [boom] });
  const env = await runDeepSearch({ queries: ["q"] }, ctx);
  assert.equal(env.ok, true, "tool-level failure is a gap, not a throw");
  assert.equal(env.results.length, 0);
  assert.ok(env.gaps.some((g) => /network down/.test(g.reason)));
});

test("deep_search: quota → unavailable gap + cooldown touched", async () => {
  const quota = fakeEngine("bing", async () => { ctxThrow(); return []; });
  function ctxThrow() { const e = new Error("429 quota"); (e as Error & { status?: number }).status = 429; throw e; }
  const ctx = mkCtx({ engines: [quota] });
  const env = await runDeepSearch({ queries: ["q1"] }, ctx);
  const g = env.gaps[0]!;
  assert.ok(["unavailable", "degraded"].includes(g.status), `quota gap status: ${g.status}`);
  assert.ok(ctx.cooldown.touched("bing"), "429 marks cooldown");
});

test("deep_search: best-effort x → degraded gap with requestedTarget", async () => {
  const x = { id: "x", search: async () => [], searchWithStatus: async () => ({ status: "unavailable" as const, hits: [], note: "empty syndication" }) } as unknown as Platform;
  const ctx = mkCtx({ platforms: [x] });
  const env = await runDeepSearch({ queries: [{ q: "qwen", target: "x" }] }, ctx);
  const g = env.gaps.find((x2) => x2.target === "x");
  assert.equal(g?.status, "unavailable");
  assert.equal(g?.requestedTarget, "x");
});

test("deep_search: doctor:true returns doctor report, no search", async () => {
  const searched = { hit: false };
  const spy = fakeEngine("bing", async () => { searched.hit = true; return []; });
  const ctx = mkCtx({ engines: [spy] });
  const env = await runDeepSearch({ doctor: true }, ctx);
  assert.equal(searched.hit, false);
  assert.ok(env.doctor, "doctor payload present");
  assert.equal(env.doctor!.engines.find((r) => r.id === "tavily")?.ready, false);
});

test("deep_search: officialConfirmation found for A-grade announcement", async () => {
  const ctx = mkCtx({ engines: [sampleEngine()] });
  const env = await runDeepSearch({ question: "Qwen4-Max 发布了没有", queries: ["Qwen4-Max 发布"] }, ctx);
  assert.equal(env.officialConfirmation.status, "found");
});

test("deep_search: budgetChars truncates + reports omitted", async () => {
  const many = fakeEngine("bing", async () =>
    Array.from({ length: 10 }, (_, i) => ({ title: `item ${i} qwen4 news`, url: `https://site${i}.test/a`, snippet: "x".repeat(400) })));
  const ctx = mkCtx({ engines: [many] });
  const env = await runDeepSearch({ queries: ["q"], budgetChars: 800 }, ctx);
  assert.ok(env.results.length < 10);
  assert.ok(env.omitted.count > 0);
});

/* ---------- research_state ---------- */

test("research_state summary: rounds + cross-validation matrix", async () => {
  const ctx = mkCtx({ engines: [sampleEngine()] });
  const e1 = await runDeepSearch({ question: "q?", queries: ["qwen4"] }, ctx);
  const s = runResearchState({ researchId: e1.researchId, action: "summary" }, ctx);
  assert.equal(s.ok, true);
  assert.equal(s.roundCount, 1);
  assert.ok(s.clusters.length >= 1);
  assert.ok(s.clusters[0]!.memberUrls.length >= 1, "matrix members available for citation");
  for (const k of Object.keys(s)) assert.ok(RESEARCH_STATE_OUTPUT_FIELDS.has(k), `undeclared key ${k}`);
});

test("research_state close releases state (execute never throws)", async () => {
  const ctx = mkCtx({ engines: [sampleEngine()] });
  const e1 = await runDeepSearch({ queries: ["q"] }, ctx);
  const c = runResearchState({ researchId: e1.researchId, action: "close" }, ctx);
  assert.equal(c.ok, true);
  assert.equal(c.released, true);
  const again = runResearchState({ researchId: e1.researchId, action: "summary" }, ctx);
  assert.equal(again.ok, false, "closed research → structured error, not a throw");
  assert.match(again.error!.message, /not found|expired/i);
});

/* ---------- verify_claims ---------- */

test("verify tool: per-claim envelopes, all fields declared", async () => {
  const ctx = mkCtx({ engines: [sampleEngine()] });
  const e1 = await runDeepSearch({ question: "q", queries: ["qwen4"] }, ctx);
  const v = await runVerifyTool({ researchId: e1.researchId, claims: [{ text: "Qwen4-Max 2026-10-10 发布" }, { text: "GPT-6 下周上线" }] }, ctx);
  assert.equal(v.ok, true);
  assert.equal(v.results.length, 2);
  assert.ok(["multi-source", "single-source"].includes(v.results[0]!.suggestion));
  assert.equal(v.results[1]!.suggestion, "no-evidence");
  for (const k of Object.keys(v)) assert.ok(VERIFY_OUTPUT_FIELDS.has(k), `undeclared key ${k}`);
});

test("verify tool: unknown researchId → structured error, no throw", async () => {
  const ctx = mkCtx();
  const v = await runVerifyTool({ researchId: "rs-nope", claims: [{ text: "x" }] }, ctx);
  assert.equal(v.ok, false);
  assert.match(v.error!.message, /not found|expired/i);
});
