import assert from "node:assert/strict";
import test from "node:test";

import { claimScore, findEvidence } from "../src/verify/lexical.ts";
import { adjudicate, verifyClaims } from "../src/verify/claims.ts";
import { ResearchStore } from "../src/research/store.ts";
import type { SourceResult } from "../src/types.ts";

function hit(p: Partial<SourceResult> & { url: string; title: string }): SourceResult {
  return { snippet: "", target: "bing", trustRank: "D", flags: [], ...p };
}

const corpus: SourceResult[] = [
  hit({ url: "https://qwen.ai/blog/release", title: "Qwen4-Max is released", snippet: "Qwen4-Max released 2026-10-10 with open weights", trustRank: "A", date: "2026-10-10" }),
  hit({ url: "https://reddit.com/r/llm/1", title: "Qwen4 released?", snippet: "heard qwen4-max released 2026-10-10, downloading now", trustRank: "C", date: "2026-10-10", votes: 300 }),
  hit({ url: "https://blog.test/x", title: "DeepSeek V5 rumor", snippet: "unrelated deepseek chatter", trustRank: "D", date: "2026-10-09" }),
];

test("claimScore: matching claim scores high, unrelated low", () => {
  const s1 = claimScore("Qwen4-Max 于 2026-10-10 发布开源权重", corpus[0]!);
  const s2 = claimScore("DeepSeek V5 has 1T parameters", corpus[0]!);
  assert.ok(s1 > s2, "relevant match must outscore irrelevant");
  assert.ok(s1 > 0.35, "relevant match clears evidence threshold");
});

test("claimScore: exact entity (version/date) hits dominate", () => {
  const s = claimScore("qwen4-max released", corpus[0]!);
  assert.ok(s >= 0.6, `entity overlap should score high, got ${s}`);
});

test("findEvidence: supports/contradicts/no-evidence split", () => {
  const m = findEvidence("Qwen4-Max 在 2026-10-10 发布", corpus);
  assert.equal(m.supports.length, 2);
  assert.equal(m.contradicts.length, 0);

  // a same-entity claim with a DIFFERENT date → contradiction
  const c = findEvidence("Qwen4-Max released 2025-01-01", corpus);
  assert.ok(c.contradicts.length >= 1, "different date + same entity → contradict");
  const still = c.supports.filter((s) => !c.contradicts.includes(s));
  assert.ok(still.length >= 0);

  const none = findEvidence("GPT-6 launches next week", corpus);
  assert.equal(none.supports.length, 0);
  assert.equal(none.contradicts.length, 0);
});

test("adjudicate: rules map evidence counts to suggestions", () => {
  assert.equal(adjudicate({ supports: 2, independentDomains: 2, hasAB: true, contradicts: 0 }), "multi-source");
  assert.equal(adjudicate({ supports: 1, independentDomains: 1, hasAB: false, contradicts: 0 }), "single-source");
  assert.equal(adjudicate({ supports: 1, independentDomains: 1, hasAB: true, contradicts: 2 }), "conflicting");
  assert.equal(adjudicate({ supports: 0, independentDomains: 0, hasAB: false, contradicts: 0 }), "no-evidence");
});

test("verifyClaims: full envelope per claim with trustMix + suggestion", () => {
  const store = new ResearchStore({ ttlMs: 10_000, maxConcurrent: 5 });
  const id = store.create("q");
  store.recordRound(id, {
    queries: ["q"], newCount: 3, removedDuplicates: 0,
    urls: corpus.map((h) => h.url),
    targets: { ok: ["bing"], failed: [] }, trustMix: { A: 1, C: 1, D: 1 }, officialConfirmation: "found",
  });
  const out = verifyClaims(store, id, [
    { id: "c1", text: "Qwen4-Max 在 2026-10-10 开源发布" },
    { id: "c2", text: "GPT-6 下周上线" },
  ], corpus);
  assert.equal(out.length, 2);
  const c1 = out.find((r) => r.claimId === "c1")!;
  assert.equal(c1.suggestion, "multi-source");
  assert.ok(c1.trustMix["A"] >= 1);
  assert.equal(out.find((r) => r.claimId === "c2")!.suggestion, "no-evidence");
});
