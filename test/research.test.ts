import assert from "node:assert/strict";
import test from "node:test";

import { ResearchStore } from "../src/research/store.ts";

function mkStore(overrides = {}) {
  let t = 0;
  const store = new ResearchStore({ ttlMs: 100, maxConcurrent: 3, now: () => t, ...overrides });
  return { store, tick: (ms: number) => { t += ms; } };
}

test("create returns an id; get round-trips question + round counter", () => {
  const { store } = mkStore();
  const id = store.create("Qwen4 发布了吗");
  assert.ok(id && id.length >= 4);
  const st = store.get(id);
  assert.equal(st.question, "Qwen4 发布了吗");
  assert.equal(st.rounds.length, 0);
  assert.equal(st.seen.size, 0);
});

test("cross-round dedupe: addSeen in round 1 hides url in round 2 via newRound", () => {
  const { store } = mkStore();
  const id = store.create("q");
  const r1 = store.newRound(id, ["qwen4 发布"]);
  assert.equal(r1.seen.size, 0);
  store.recordRound(id, {
    queries: ["qwen4 发布"],
    newCount: 2,
    removedDuplicates: 0,
    urls: ["https://a.test/1", "https://b.test/2"],
    targets: { ok: ["bing"], failed: [] },
    trustMix: { A: 1, C: 1 },
    officialConfirmation: "none",
  });
  const r2 = store.newRound(id, ["qwen4 weights"]);
  assert.ok(r2.seen.has("https://a.test/1"), "known urls carried into next round");
  assert.equal(store.get(id).rounds.length, 1);
});

test("stats: totals across rounds", () => {
  const { store } = mkStore();
  const id = store.create("q");
  store.recordRound(id, { queries: ["a"], newCount: 2, removedDuplicates: 1, urls: ["https://a.test/1", "https://b.test/2"], targets: { ok: ["bing"], failed: ["x"] }, trustMix: { A: 1, C: 1 }, officialConfirmation: "none" });
  store.recordRound(id, { queries: ["b"], newCount: 1, removedDuplicates: 3, urls: ["https://c.test/3"], targets: { ok: ["github"], failed: [] }, trustMix: { B: 1 }, officialConfirmation: "found" });
  const s = store.stats(id);
  assert.equal(s.roundCount, 2);
  assert.equal(s.totalNew, 3);
  assert.equal(s.totalSeen, 3);
  assert.deepEqual(s.targetsOk.sort(), ["bing", "github"]);
  assert.deepEqual(s.targetsFailed, ["x"]);
  assert.deepEqual(s.trustMix, { A: 1, B: 1, C: 1 });
  assert.equal(s.officialConfirmation, "found");
  assert.equal(s.maxRoundsReached, false);
});

test("TTL: research expires and get() throws for missing id", () => {
  const { store, tick } = mkStore();
  const id = store.create("q");
  tick(50);
  assert.ok(store.get(id));
  tick(120);
  assert.throws(() => store.get(id), /not found|expired/i);
});

test("concurrency cap: oldest research evicted beyond maxConcurrent", () => {
  const { store } = mkStore();
  const a = store.create("a");
  const b = store.create("b");
  const c = store.create("c");
  const d = store.create("d"); // evicts a (oldest)
  assert.throws(() => store.get(a), /not found/i);
  assert.ok(store.get(b));
  assert.ok(store.get(d));
});

test("close releases; reset keeps id but clears rounds+seen", () => {
  const { store } = mkStore();
  const id = store.create("q");
  store.recordRound(id, { queries: ["a"], newCount: 1, removedDuplicates: 0, urls: ["https://a.test/1"], targets: { ok: ["bing"], failed: [] }, trustMix: { A: 1 }, officialConfirmation: "found" });
  const summary = store.close(id);
  assert.equal(summary.totalSeen, 1);
  assert.throws(() => store.get(id), /not found/i);

  const id2 = store.create("q2");
  store.recordRound(id2, { queries: ["a"], newCount: 1, removedDuplicates: 0, urls: ["https://z.test"], targets: { ok: ["bing"], failed: [] }, trustMix: { C: 1 }, officialConfirmation: "none" });
  store.reset(id2);
  assert.equal(store.get(id2).rounds.length, 0);
  assert.equal(store.get(id2).seen.size, 0);
});

test("maxRoundsReached true at configured cap", () => {
  const { store } = mkStore();
  const id = store.create("q", 2);
  store.recordRound(id, { queries: ["a"], newCount: 1, removedDuplicates: 0, urls: ["https://a.test/1"], targets: { ok: ["bing"], failed: [] }, trustMix: { C: 1 }, officialConfirmation: "none" });
  store.recordRound(id, { queries: ["b"], newCount: 1, removedDuplicates: 0, urls: ["https://b.test/2"], targets: { ok: ["bing"], failed: [] }, trustMix: { C: 1 }, officialConfirmation: "none" });
  assert.equal(store.stats(id).maxRoundsReached, true);
});
