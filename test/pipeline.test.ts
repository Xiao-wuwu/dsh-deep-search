import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { normalizeUrl, normSnippet } from "../src/pipeline/normalize.ts";
import { dedupeUrls } from "../src/pipeline/dedupe.ts";
import { clusterHits } from "../src/pipeline/cluster.ts";
import { extractMeta } from "../src/pipeline/extract.ts";
import { gradeTrust, deriveFlags } from "../src/pipeline/trust.ts";
import { budgetEnvelope } from "../src/pipeline/budget.ts";
import { officialConfirmation, buildHint } from "../src/pipeline/envelope.ts";
import type { SourceResult } from "../src/types.ts";

const trust = JSON.parse(readFileSync(new URL("../catalog/trust.v1.json", import.meta.url), "utf8"));

function hit(p: Partial<SourceResult> & { url: string; title: string }): SourceResult {
  return { snippet: "", target: "bing", trustRank: "D", flags: [], ...p };
}

/* ---------- normalize ---------- */

test("normalizeUrl: strips utm/fragment/trailing slash, lowercases host", () => {
  assert.equal(normalizeUrl("HTTPS://Qwen.AI/Blog/?utm_source=x&b=2#frag"), "https://qwen.ai/Blog?b=2");
  assert.equal(normalizeUrl("https://a.test/path/"), "https://a.test/path");
});

test("normSnippet: whitespace collapse + lower + CJK kept", () => {
  assert.equal(normSnippet("  Qwen4  已  发布\t! "), "qwen4 已 发布!");
});

/* ---------- dedupe ---------- */

test("dedupeUrls: same normalized url within round and against seen set", () => {
  const seen = new Set(["https://a.test/1"]);
  const r = dedupeUrls([hit({ url: "https://a.test/1?utm=x", title: "dup" }), hit({ url: "https://b.test/2", title: "new" })], seen);
  assert.equal(r.hits.length, 1);
  assert.equal(r.removed, 1);
  assert.ok(seen.has("https://b.test/2"));
});

/* ---------- cluster ---------- */

test("clusterHits: near-duplicate titles share cluster; different events split", () => {
  const hits = [
    hit({ url: "https://a.test/1", title: "Qwen4 Max released open weights", snippet: "Qwen4 Max released with open weights today" }),
    hit({ url: "https://b.test/2", title: "Qwen4-Max is released, open weights", snippet: "Qwen4 Max released with open weights today" }),
    hit({ url: "https://c.test/3", title: "DeepSeek V5 rumor", snippet: "unrelated topic about deepseek" }),
  ];
  const clusters = clusterHits(hits);
  assert.equal(hits[0]!.clusterId, hits[1]!.clusterId, "same event → same cluster");
  assert.notEqual(hits[0]!.clusterId, hits[2]!.clusterId);
  const c = clusters.find((x) => x.clusterId === hits[0]!.clusterId)!;
  assert.equal(c.size, 2);
  assert.equal(hits[0]!.clusterSize, 2);
});

/* ---------- extract ---------- */

test("extractMeta: accounts/dates/versions/quotes/actionWords", () => {
  const m = extractMeta("QwenDevs said @QwenTeam: \"big or small\" — Qwen4-Max 27B 开源同步发布 https://x.test");
  assert.deepEqual(m.accounts, ["@QwenTeam"]);
  assert.ok(m.dates.length === 0);
  assert.ok(m.versions.includes("Qwen4-Max"));
  assert.deepEqual(m.quotes, ["big or small"]);
  assert.ok(m.actionWords.includes("开源"));
  assert.ok(m.actionWords.includes("发布"));
});

test("extractMeta: ISO + relative dates", () => {
  const m = extractMeta("released 2026-10-10, updated 2026/10/12 and Oct 9");
  assert.ok(m.dates.includes("2026-10-10"));
  assert.ok(m.dates.includes("2026-10-12"));
});

/* ---------- trust ---------- */

test("gradeTrust: A official domain, B official account author, C community, D unknown", () => {
  assert.equal(gradeTrust(hit({ url: "https://qwen.ai/blog", target: "bing" }), trust), "A");
  assert.equal(gradeTrust(hit({ url: "https://huggingface.co/Qwen/Qwen4", target: "huggingface" }), trust), "A");
  assert.equal(gradeTrust(hit({ url: "https://x.com/foo", target: "x", author: "QwenLM" }), trust), "B");
  assert.equal(gradeTrust(hit({ url: "https://reddit.com/r/llm/x", target: "reddit" }), trust), "C");
  assert.equal(gradeTrust(hit({ url: "https://random-blog.test/post", target: "bing" }), trust), "D");
});

// Regression guard (found by real-network smoke 2026-10-15): generic hosts score A
// ONLY when the URL owner is a verified official org — personal spaces are community C.
test("gradeTrust: owner-verified A vs personal-space C on generic hosts", () => {
  // official orgs (present in trust.v1.json officialAccounts)
  assert.equal(gradeTrust(hit({ url: "https://github.com/QwenLM/Qwen3-VL", target: "github" }), trust), "A");
  assert.equal(gradeTrust(hit({ url: "https://huggingface.co/deepseek-ai/DeepSeek-V3", target: "huggingface" }), trust), "A");
  assert.equal(gradeTrust(hit({ url: "https://www.modelscope.cn/models/Qwen/Qwen4-Max", target: "modelscope" }), trust), "A");
  // personal/fork spaces must NOT be A
  assert.equal(gradeTrust(hit({ url: "https://github.com/someuser/wuying-qwen-office", target: "github" }), trust), "C");
  assert.equal(gradeTrust(hit({ url: "https://www.modelscope.cn/models/someuser/Qwen-LoRA-finetune", target: "modelscope" }), trust), "C");
  assert.equal(gradeTrust(hit({ url: "https://huggingface.co/randomuser/my-gguf", target: "huggingface" }), trust), "C");
});

test("deriveFlags: clickbait/satire/content_farm/single_source/low_trust_only", () => {
  const click = hit({ url: "https://blog.test/x", title: "震惊！某厂炸裂发布", target: "bing" });
  click.trustRank = gradeTrust(click, trust);
  deriveFlags([click], [clusterHits([click])].flat(), trust, { expectsOfficial: true });
  assert.ok(click.flags.includes("clickbait"));

  const farm = hit({ url: "https://www.360kuai.com/a", title: "t", target: "bing" });
  farm.trustRank = gradeTrust(farm, trust);
  const cs = clusterHits([farm]);
  deriveFlags([farm], cs, trust, {});
  assert.ok(farm.flags.includes("content_farm"));
  assert.ok(farm.flags.includes("single_source"));

  const lone = hit({ url: "https://random.test/p", title: "t", target: "bing" });
  lone.trustRank = "D";
  deriveFlags([lone], clusterHits([lone]), trust, { expectsOfficial: true });
  assert.ok(lone.flags.includes("low_trust_only"));
});

test("deriveFlags: date_conflict when cluster spans wildly different dates", () => {
  const a = hit({ url: "https://a.test/1", title: "Qwen4 released", snippet: "Qwen4 released", date: "2026-10-10" });
  const b = hit({ url: "https://b.test/2", title: "Qwen4 released", snippet: "Qwen4 released", date: "2024-01-01" });
  a.trustRank = b.trustRank = "C";
  const cs = clusterHits([a, b]);
  deriveFlags([a, b], cs, trust, {});
  assert.ok(a.flags.includes("date_conflict") || b.flags.includes("date_conflict"));
});

/* ---------- budget + envelope ---------- */

test("budgetEnvelope: A>B>C>D then clusterSize then recency; reports omitted", () => {
  const hits = [
    hit({ url: "https://d.test", title: "d", target: "bing", trustRank: "D", snippet: "x".repeat(100) }),
    hit({ url: "https://a.test", title: "a", target: "bing", trustRank: "A", date: "2026-10-10", snippet: "y".repeat(100) }),
    hit({ url: "https://c.test", title: "c", target: "bing", trustRank: "C", snippet: "z".repeat(100) }),
  ];
  const r = budgetEnvelope(hits, { maxItems: 2 });
  assert.equal(r.kept.length, 2);
  assert.equal(r.kept[0]!.trustRank, "A");
  assert.equal(r.omittedCount, 1);
});

test("officialConfirmation: found for A/B matching entities, else none", () => {
  const ann = hit({ url: "https://qwen.ai/blog", title: "Qwen4-Max released", target: "huggingface", trustRank: "A", extracted: undefined } as SourceResult);
  (ann as { extracted?: unknown }).extracted = { accounts: [], dates: ["2026-10-10"], versions: ["Qwen4-Max"], quotes: [], actionWords: ["发布"] };
  const r = officialConfirmation([ann], "Qwen4-Max 发布了吗");
  assert.equal(r.status, "found");
  assert.equal(r.evidence[0], ann.url);

  const none = officialConfirmation([hit({ url: "https://r.test/1", title: "rumor", target: "reddit", trustRank: "C" })], "Qwen4-Max 发布了吗");
  assert.equal(none.status, "none");
});

test("buildHint: coverage + suggest (expand when thin, shrink when noisy)", () => {
  const thin = buildHint({ ok: ["github"], failed: ["x"], newCount: 2 });
  assert.match(thin.coverage, /github/);
  assert.ok(thin.suggest.length > 0);
  const noisy = buildHint({ ok: ["bing"], failed: [], newCount: 40 });
  assert.ok(noisy.suggest.some((s) => /引号|site:|精确/.test(s)));
});
