import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { buildToolDefinitions, TOOL_NAMES } from "../src/tools.ts";
import type { ToolCtx } from "../src/tools/core.ts";
import { ResearchStore } from "../src/research/store.ts";
import { Cooldown } from "../src/http/limits.ts";
import { CacheStore } from "../src/http/cache.ts";
import type { Config } from "../src/config.ts";
import type { Engine } from "../src/engines/types.ts";

const trust = JSON.parse(readFileSync(new URL("../catalog/trust.v1.json", import.meta.url), "utf8"));
const cfg: Config = {
  engines: { enabled: ["bing"], searxngInstances: [], proxyByTarget: {} },
  platforms: { enabled: [], custom: [], xEndpoint: "" },
  limits: { concurrency: 4, perTargetConcurrency: 2, queryTimeoutMs: 15000, maxQueriesPerCall: 24, maxRounds: 5, budgetChars: 9000, rateLimitPerMinute: 60 },
  cooldown: { enabled: true, minutes: 15 },
  cache: { lruSize: 50, ttlMinutes: 10, persist: false },
  trust: { extraOfficialDomains: [], extraOfficialAccounts: [], extraFarmPatterns: [] },
  promptInjection: true, researchTtlMinutes: 120,
};
const fakeEngine: Engine = { id: "bing", timeRange: true, search: async () => [
  { title: "Qwen4-Max released", url: "https://qwen.ai/blog/qwen4", snippet: "official Qwen4-Max release", date: "2026-10-10" },
] };

function mkCtx(): ToolCtx {
  return {
    cfg,
    store: new ResearchStore({ ttlMs: 120_000, maxConcurrent: 20 }),
    cooldown: new Cooldown(),
    cache: new CacheStore({ lruSize: 100, ttlMs: 60_000 }),
    trustSpec: trust,
    engines: [fakeEngine],
    platforms: [],
    disabled: { engines: [], platforms: [] },
    maxConcurrentResearch: 20,
    researchTtlMs: 120_000,
  };
}

const exec = () => ({ signal: new AbortController().signal, deferContext() {} }) as never;

test("buildToolDefinitions: three tools, correct names + unique", () => {
  const defs = buildToolDefinitions(mkCtx());
  assert.equal(defs.length, 3);
  assert.deepEqual(defs.map((d) => d.name), [...TOOL_NAMES]);
  assert.equal(new Set(defs.map((d) => d.name)).size, 3);
  for (const d of defs) {
    assert.equal(typeof d.execute, "function");
    assert.ok(d.output && d.output.schema, `${d.name} missing output schema`);
    assert.ok(Array.isArray(d.parameters) || typeof d.parameters === "object", `${d.name} missing parameters`);
  }
});

test("deep_search shell: execute wired to core, returns envelope", async () => {
  const defs = buildToolDefinitions(mkCtx());
  const deep = defs.find((d) => d.name === "deep_search")!;
  const value = await deep.execute({ queries: ["qwen4 发布"] }, exec()) as Record<string, unknown>;
  assert.equal(value.ok, true);
  assert.ok(Array.isArray(value.results));
  assert.equal((value.results as unknown[]).length, 1);
  assert.equal(value.round, 1);
});

test("deep_search shell: presentCall labels the first query", () => {
  const defs = buildToolDefinitions(mkCtx());
  const deep = defs.find((d) => d.name === "deep_search")!;
  assert.equal(typeof deep.presentCall, "function");
  const view = deep.presentCall!({ queries: ["hello world"] });
  assert.ok(view && (view as { title?: string }).title === "hello world");
});

test("research_state + verify shells wired: execute reaches core without throwing", async () => {
  const ctx = mkCtx();
  const defs = buildToolDefinitions(ctx);
  const deep = defs.find((d) => d.name === "deep_search")!;
  const state = defs.find((d) => d.name === "research_state")!;
  const verify = defs.find((d) => d.name === "verify_claims")!;

  const env = await deep.execute({ queries: ["qwen4 发布"] }, exec()) as { researchId: string };
  const s = await state.execute({ researchId: env.researchId, action: "summary" }, exec()) as Record<string, unknown>;
  assert.equal(s.ok, true);
  assert.equal(s.roundCount, 1);

  const v = await verify.execute({ researchId: env.researchId, claims: [{ text: "Qwen4-Max 发布" }] }, exec()) as Record<string, unknown>;
  assert.equal(v.ok, true);
  assert.ok(Array.isArray(v.results));

  const bad = await state.execute({ researchId: "rs-missing", action: "summary" }, exec()) as { ok: boolean; error?: { code?: string } };
  assert.equal(bad.ok, false, "never throws — structured error even on unknown researchId");
});
