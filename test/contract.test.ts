import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Host-faithful contract test: feed the REAL envelope through the HOST's own schema
// validator (valueSchemaSpecToJsonSchema + validateJsonSchemaValue), exactly as the
// runtime does. This is the guard that the field-set test could NOT provide — it
// caught a live 2026-10-15 drift where clusters[].independentDomains was projected
// but not declared, which the host rejected under additionalProperties:false.
import { valueSchemaSpecToJsonSchema, validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";

import { runDeepSearch, runResearchState, runVerifyTool, type ToolCtx } from "../src/tools/core.ts";
import { deepSearchOutput, researchStateOutput, verifyOutput } from "../src/tools/schemas.ts";
import { ResearchStore } from "../src/research/store.ts";
import { Cooldown } from "../src/http/limits.ts";
import { CacheStore } from "../src/http/cache.ts";
import type { Config } from "../src/config.ts";
import type { Engine } from "../src/engines/types.ts";

const trust = JSON.parse(readFileSync(new URL("../catalog/trust.v1.json", import.meta.url), "utf8"));
const cfg: Config = {
  engines: { enabled: ["bing"], searxngInstances: [], proxyByTarget: {} },
  platforms: { enabled: ["github"], custom: [], xEndpoint: "" },
  limits: { concurrency: 4, perTargetConcurrency: 2, queryTimeoutMs: 15000, maxQueriesPerCall: 24, maxRounds: 5, budgetChars: 9000, rateLimitPerMinute: 60 },
  cooldown: { enabled: true, minutes: 15 },
  cache: { lruSize: 50, ttlMinutes: 10, persist: false },
  trust: { extraOfficialDomains: [], extraOfficialAccounts: [], extraFarmPatterns: [] },
  promptInjection: true, researchTtlMinutes: 120,
};

// Rich fixture: exercises clusters, extracted, votes, dates, omitted, doctor, errors.
function richEngine(): Engine {
  return {
    id: "bing", timeRange: true,
    search: async () => Array.from({ length: 12 }, (_, i) => ({
      title: `Qwen4-Max released open weights report ${i}`,
      url: `https://site${i}.test/post/${i}`,
      snippet: "Qwen4-Max released 2026-10-10 with open weights, official announcement details ".repeat(12),
      date: "2026-10-10", author: i === 0 ? "QwenLM" : `dev${i}`, votes: 500 - i, comments: i,
    })),
  };
}

function mkCtx(): ToolCtx {
  return {
    cfg, store: new ResearchStore({ ttlMs: 120_000, maxConcurrent: 20 }),
    cooldown: new Cooldown(), cache: new CacheStore({ lruSize: 100, ttlMs: 60_000 }),
    trustSpec: trust, engines: [richEngine()], platforms: [],
    disabled: { engines: [{ id: "tavily", reason: "missing credential for tavily (ref: TAVILY_API_KEY)" }], platforms: [] },
    maxConcurrentResearch: 20, researchTtlMs: 120_000,
  };
}

function assertHostValid(name: string, spec: typeof deepSearchOutput, value: unknown): void {
  const schema = valueSchemaSpecToJsonSchema(spec);
  const violations = validateJsonSchemaValue(schema, value);
  assert.deepEqual(violations, [], `${name} failed HOST schema validation:\n` + violations.slice(0, 8).join("\n"));
}

test("deep_search envelope passes the HOST validator (incl. clusters[].independentDomains)", async () => {
  const ctx = mkCtx();
  const env = await runDeepSearch({ question: "Qwen4-Max 发布了吗", queries: ["Qwen4-Max 发布"] }, ctx);
  assert.equal(env.ok, true);
  assert.ok((env.clusters as unknown[]).length >= 1, "must exercise the clusters sub-schema");
  // the exact field that regressed live:
  assert.ok("independentDomains" in (env.clusters as Record<string, unknown>[])[0]!);
  assertHostValid("deep_search", deepSearchOutput, env);
});

test("deep_search with budget truncation (omitted present) passes HOST validator", async () => {
  const ctx = mkCtx();
  const env = await runDeepSearch({ question: "Qwen4 发布", queries: ["Qwen4"], budgetChars: 900 }, ctx);
  assert.ok(env.omitted, "expected omitted under a tight budget");
  assertHostValid("deep_search(omitted)", deepSearchOutput, env);
});

test("deep_search doctor payload + error envelope pass HOST validator", async () => {
  const ctx = mkCtx();
  assertHostValid("deep_search(doctor)", deepSearchOutput, await runDeepSearch({ doctor: true } as never, ctx));
  assertHostValid("deep_search(badargs)", deepSearchOutput, await runDeepSearch({} as never, ctx));
});

test("research_state summary (matrix) passes HOST validator", async () => {
  const ctx = mkCtx();
  const e1 = await runDeepSearch({ question: "q?", queries: ["Qwen4-Max 发布"] }, ctx);
  const s = runResearchState({ researchId: String(e1.researchId), action: "summary" }, ctx);
  assert.ok((s.clusters as unknown[]).length >= 1);
  assertHostValid("research_state(summary)", researchStateOutput, s);
  assertHostValid("research_state(close)", researchStateOutput, runResearchState({ researchId: String(e1.researchId), action: "close" }, ctx));
});

test("verify_claims envelope passes HOST validator", async () => {
  const ctx = mkCtx();
  const e1 = await runDeepSearch({ question: "q", queries: ["Qwen4-Max 发布"] }, ctx);
  const v = runVerifyTool({ researchId: String(e1.researchId), claims: [{ text: "Qwen4-Max 2026-10-10 开源" }] }, ctx);
  assertHostValid("verify_claims", verifyOutput, v);
  assertHostValid("verify_claims(missing research)", verifyOutput, runVerifyTool({ researchId: "rs-nope", claims: [{ text: "x" }] }, ctx));
});

test('deep_search envelope omits singleton clusters but research_state keeps the full matrix', async () => {
  const ctx = mkCtx();
  const env = await runDeepSearch({ question: 'q', queries: ['Qwen4-Max 发布'] }, ctx);
  const sizes = (env.clusters as { size: number }[]).map((c) => c.size);
  assert.ok(sizes.every((s) => s >= 2), 'envelope must ship only multi-source clusters');
  const st = runResearchState({ researchId: String(env.researchId), action: 'summary' }, ctx);
  assert.ok((st.clusters as unknown[]).length >= sizes.length, 'full matrix survives in the store');
});
