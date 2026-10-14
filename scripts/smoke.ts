/** 真网络端到端冒烟（env DSH_DS_VERIFY=1 才允许跑）。
 *  验证：免Key通道真实可用 + verify-tier(bilibili/weibo) 可用性判定 + gaps 诚实透出。 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { mergeConfig, defaultConfig } from "../src/config.ts";
import { resolveCreds } from "../src/credentials.ts";
import { createHttpClient } from "../src/http/client.ts";
import { CacheStore } from "../src/http/cache.ts";
import { Cooldown, RateBucket } from "../src/http/limits.ts";
import { buildEngines } from "../src/engines/registry.ts";
import { buildPlatforms } from "../src/platforms/registry.ts";
import { ResearchStore } from "../src/research/store.ts";
import { runDeepSearch, runResearchState, runVerifyTool, type ToolCtx } from "../src/tools/core.ts";

if (process.env.DSH_DS_VERIFY !== "1") {
  console.error("set DSH_DS_VERIFY=1 to run the real-network smoke");
  process.exit(2);
}

const trustSpec = JSON.parse(readFileSync(fileURLToPath(new URL("../catalog/trust.v1.json", import.meta.url)), "utf8"));
const cfg = mergeConfig({
  engines: { enabled: ["bing", "ddg", "searxng", "mojeek"] },
  platforms: { enabled: ["github", "huggingface", "modelscope", "hackernews", "v2ex", "bilibili", "weibo", "x"] },
  limits: { queryTimeoutMs: 12000, concurrency: 6, rateLimitPerMinute: 60 },
});

const http = createHttpClient({ timeoutMs: cfg.limits.queryTimeoutMs });
const cooldown = new Cooldown();
const cache = new CacheStore({ lruSize: 100, ttlMs: 600_000 });
const bucket = new RateBucket({ perMinute: cfg.limits.rateLimitPerMinute });
const deps = { http, cooldown, cache, bucket };
const creds = resolveCreds(new Map(Object.entries(process.env).filter(([, v]) => v) as [string, string][]));

const engines = buildEngines(cfg.engines, creds, deps);
const platforms = buildPlatforms(cfg.platforms, creds, deps);

const ctx: ToolCtx = {
  cfg, store: new ResearchStore({ ttlMs: 120_000, maxConcurrent: 20 }),
  cooldown, cache, trustSpec,
  engines: engines.active, platforms: platforms.active,
  disabled: { engines: engines.disabled, platforms: platforms.disabled },
  maxConcurrentResearch: 20, researchTtlMs: 120_000,
};

const t0 = Date.now();
const env1 = await runDeepSearch({
  question: "Qwen 最新模型发布了什么？权重是否开源？",
  queries: [
    "Qwen latest model release open weights",
    { q: "Qwen", target: "github", maxResults: 5 },
    { q: "Qwen", target: "modelscope", maxResults: 5 },
    { q: "Qwen", target: "huggingface", maxResults: 5 },
    { q: "Qwen", target: "bilibili", maxResults: 5 },
    { q: "通义千问 Qwen 发布", target: "weibo", maxResults: 5 },
    { q: "qwen", target: "x" },
    { q: "Qwen open source release", target: "bing" },
    { q: "Qwen release", target: "ddg" },
    { q: "Qwen release", target: "hackernews", timeRange: "month" },
    { q: "Qwen", target: "v2ex" },
  ],
  budgetChars: 12000,
}, ctx);

console.log(`── round1 (${Date.now() - t0}ms) researchId=${env1.researchId} round=${env1.round} newCount=${env1.newCount} dupes=${env1.skippedDuplicates}`);
console.log("officialConfirmation:", JSON.stringify(env1.officialConfirmation));
console.log("trustMix:", JSON.stringify(env1.results.reduce<Record<string, number>>((m, r) => { m[r.trustRank] = (m[r.trustRank] ?? 0) + 1; return m; }, {})));
console.log("── perTarget:");
for (const [id, v] of Object.entries(env1.stats.perTarget as Record<string, { hits: number; ms: number; error?: string }>)) {
  console.log(`  ${id.padEnd(14)} hits=${String(v.hits).padStart(3)} ms=${String(v.ms).padStart(6)}${v.error ? ` ERROR=${String(v.error).slice(0, 90)}` : ""}`);
}
console.log("── gaps:");
for (const g of env1.gaps) console.log(`  [${g.status}] ${g.target}: ${g.reason}`);
console.log("── top results (A/B first):");
for (const r of env1.results.slice(0, 10)) {
  console.log(`  (${r.trustRank}) [${r.target}] ${r.title.slice(0, 70)} ${r.date ?? ""} flags=[${r.flags.join(",")}]`);
}
console.log("── clusters:");
for (const c of env1.clusters) console.log(`  ${c.clusterId} size=${c.size} domains=${c.independentDomains} mix=${JSON.stringify(c.trustMix)} :: ${String(c.topTitle).slice(0, 60)}`);
console.log("── hint:", env1.hint.coverage);
for (const s of env1.hint.suggest) console.log("   suggest:", s);

// 第二轮：验证跨轮去重
const env2 = await runDeepSearch({
  researchId: env1.researchId,
  queries: [{ q: "Qwen", target: "modelscope", maxResults: 5 }, { q: "Qwen", target: "github", maxResults: 5 }],
}, ctx);
console.log(`── round2 newCount=${env2.newCount} dupes=${env2.skippedDuplicates} (期望 dupes>0=跨轮去重生效)`);

const summary = runResearchState({ researchId: env1.researchId, action: "summary" }, ctx) as Record<string, unknown>;
console.log("── state: roundCount=", summary.roundCount, "totalSeen=", summary.totalSeen, "matrix clusters=", (summary.clusters as unknown[]).length);

const verify = runVerifyTool({
  researchId: env1.researchId,
  claims: [
    { text: "Qwen 发布了最新开源模型" },
    { text: "GPT-6 已经正式发布" },
  ],
}, ctx) as { results: { claim: string; suggestion: string; independentSources: number }[] };
for (const v of verify.results) console.log(`── verify: [${v.suggestion}] src=${v.independentSources} :: ${v.claim.slice(0, 40)}`);

// 专项：bilibili / weibo 可用性判定（用户点名验证）
const bili = platforms.active.find((p) => p.id === "bilibili") as { searchWithStatus?: (q: string) => Promise<{ status: string; hits: unknown[]; note?: string }> } | undefined;
const weibo = platforms.active.find((p) => p.id === "weibo") as typeof bili;
const x = platforms.active.find((p) => p.id === "x") as typeof bili;
console.log("── verify-tier 专项判定:");
for (const [name, plat] of [["bilibili", bili], ["weibo", weibo], ["x", x]] as const) {
  if (!plat) { console.log(`  ${name}: ABSENT(${JSON.stringify(platforms.disabled.find((d) => d.id === name))})`); continue; }
  try {
    const r = await plat.searchWithStatus!("qwen4");
    console.log(`  ${name}: status=${r.status} hits=${r.hits.length}${r.note ? ` note=${r.note}` : ""}`);
  } catch (e) { console.log(`  ${name}: THREW ${String((e as Error).message).slice(0, 80)}`); }
}
console.log("disabled at boot:", JSON.stringify({ engines: engines.disabled.map((d) => d.id), platforms: platforms.disabled.map((d) => d.id) }));
