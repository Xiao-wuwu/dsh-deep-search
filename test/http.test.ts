import assert from "node:assert/strict";
import test from "node:test";

import { CacheStore } from "../src/http/cache.ts";
import { RateBucket } from "../src/http/limits.ts";
import { Cooldown } from "../src/http/limits.ts";
import { pickUa, UA_POOL } from "../src/http/ua.ts";

/* ---------- cache ---------- */

test("cache: get misses → undefined; set→get round-trips", () => {
  const c = new CacheStore({ lruSize: 3, ttlMs: 10_000, now: () => 1000 });
  assert.equal(c.get("a"), undefined);
  c.set("a", 42);
  assert.equal(c.get("a"), 42);
});

test("cache: TTL expiry (entry gone after ttl), stale not resurrected", () => {
  let t = 0;
  const c = new CacheStore({ lruSize: 8, ttlMs: 100, now: () => t });
  c.set("k", "v");
  t = 50;
  assert.equal(c.get("k"), "v");
  t = 150;
  assert.equal(c.get("k"), undefined);
  assert.equal(c.get("k"), undefined, "second read must not resurrect");
});

test("cache: LRU eviction keeps most-recently-used", () => {
  const c = new CacheStore({ lruSize: 2, ttlMs: 10_000, now: () => 1 });
  c.set("a", 1);
  c.set("b", 2);
  c.get("a"); // touch a → b becomes LRU
  c.set("c", 3); // evicts b
  assert.equal(c.get("a"), 1);
  assert.equal(c.get("b"), undefined);
  assert.equal(c.get("c"), 3);
});

/* ---------- rate bucket ---------- */

test("bucket: consumes capacity then rejects until refill", () => {
  let t = 0;
  const b = new RateBucket({ perMinute: 3, now: () => t });
  assert.equal(b.tryConsume(), true);
  assert.equal(b.tryConsume(), true);
  assert.equal(b.tryConsume(), true);
  assert.equal(b.tryConsume(), false, "4th within window rejected");
  t = 61_000; // window passed
  assert.equal(b.tryConsume(), true);
});

test("bucket: retryAfterMs positive when empty, 0 when available", () => {
  let t = 0;
  const b = new RateBucket({ perMinute: 1, now: () => t });
  assert.equal(b.tryConsume(), true);
  assert.ok(b.retryAfterMs() > 0, "bucket full → must report wait time");
  t = 61_000;
  assert.equal(b.retryAfterMs(), 0, "window passed → available again");
  assert.equal(b.tryConsume(), true);
});

/* ---------- cooldown registry ---------- */

test("cooldown: mark makes engine skipped until window passes, then auto-heals", () => {
  let t = 0;
  const cd = new Cooldown({ now: () => t });
  assert.equal(cd.touched("tavily"), false);
  cd.mark("tavily", 15); // 15 minutes
  assert.equal(cd.touched("tavily"), true);
  t = 14 * 60_000;
  assert.equal(cd.touched("tavily"), true, "still cooling at 14min");
  t = 16 * 60_000;
  assert.equal(cd.touched("tavily"), false, "auto-healed after 15min");
});

test("cooldown: list() reports remaining time; clear forgets all", () => {
  let t = 0;
  const cd = new Cooldown({ now: () => t });
  cd.mark("bing", 10);
  t = 4 * 60_000;
  const rows = cd.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, "bing");
  assert.ok(Math.abs(rows[0]!.untilMs - 600_000) < 1, "until = mark+window");
  cd.clear();
  assert.equal(cd.touched("bing"), false);
});

/* ---------- UA pool ---------- */

test("ua: pool non-empty, all look like desktop UAs", () => {
  assert.ok(UA_POOL.length >= 4);
  for (const ua of UA_POOL) {
    assert.match(ua, /Mozilla\/5\.0/);
    assert.doesNotMatch(ua, /HeadlessChrome/);
  }
});

test("ua: pickUa is deterministic per seed but varies across seeds", () => {
  assert.equal(pickUa("q1"), pickUa("q1"));
  assert.notEqual(pickUa("q1"), pickUa("q2"));
  assert.ok(UA_POOL.includes(pickUa("anything")));
});
