import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TRUST_RANKS,
  isTrustRank,
  normalizeTrust,
} from "../src/types.ts";
import type {
  Flag,
  Gap,
  SourceResult,
  SourceSpec,
  TrustSpec,
  TrustRank,
} from "../src/types.ts";

function loadJson(relative: string): unknown {
  return JSON.parse(
    readFileSync(new URL(relative, import.meta.url), "utf8"),
  ) as unknown;
}

test("TRUST_RANKS is exactly A/B/C/D in order", () => {
  assert.deepEqual([...TRUST_RANKS], ["A", "B", "C", "D"]);
});

test("isTrustRank accepts the four ranks and rejects anything else", () => {
  for (const rank of TRUST_RANKS) assert.equal(isTrustRank(rank), true);
  assert.equal(isTrustRank("E"), false);
  assert.equal(isTrustRank("a"), false, "guard must be case-sensitive");
  assert.equal(isTrustRank(""), false);
  assert.equal(isTrustRank(undefined), false);
  assert.equal(isTrustRank(null), false);
  assert.equal(isTrustRank(1), false);
});

test("normalizeTrust uppercases and validates, else falls back to D", () => {
  assert.equal(normalizeTrust("a"), "A");
  assert.equal(normalizeTrust("A"), "A");
  assert.equal(normalizeTrust(" b "), "B");
  assert.equal(normalizeTrust("C"), "C");
  assert.equal(normalizeTrust("d"), "D");
  // Unknown / missing input is never silently promoted to a trusted rank.
  assert.equal(normalizeTrust("E"), "D");
  assert.equal(normalizeTrust(""), "D");
  assert.equal(normalizeTrust("official"), "D");
  assert.equal(normalizeTrust(undefined), "D");
  assert.equal(normalizeTrust(null), "D");
  assert.equal(normalizeTrust(7), "D");
});

test("normalizeTrust output is always a TrustRank (round-trip guard)", () => {
  const inputs = ["a", "B", "  c  ", "D", "E", "", "zzz", undefined];
  for (const raw of inputs) {
    const normalized = normalizeTrust(raw as string | undefined);
    assert.equal(
      isTrustRank(normalized),
      true,
      `normalizeTrust(${String(raw)}) returned non-rank ${normalized}`,
    );
  }
});

test("catalog/sources.v1.json loads and every entry has id + kind", () => {
  const catalog = loadJson("../catalog/sources.v1.json") as {
    version?: number;
    sources: SourceSpec[];
  };
  assert.ok(Array.isArray(catalog.sources), "sources must be an array");
  assert.ok(catalog.sources.length > 0, "sources must not be empty");

  const ids = new Set<string>();
  for (const entry of catalog.sources) {
    assert.equal(
      typeof entry.id,
      "string",
      `entry missing id: ${JSON.stringify(entry)}`,
    );
    assert.ok(entry.id.length > 0, "entry id must be non-empty");
    assert.ok(
      !ids.has(entry.id),
      `duplicate source id: ${entry.id}`,
    );
    ids.add(entry.id);
    assert.equal(typeof entry.kind, "string", `${entry.id} missing kind`);
    assert.ok(
      entry.kind === "engine" || entry.kind === "platform",
      `${entry.id} has unknown kind ${entry.kind}`,
    );
    assert.ok(
      ["free", "keyed", "verify", "best-effort"].includes(entry.tier),
      `${entry.id} has unknown tier ${entry.tier}`,
    );
    assert.equal(
      typeof entry.endpointTemplate,
      "string",
      `${entry.id} missing endpointTemplate`,
    );
    assert.ok(
      entry.endpointTemplate.length > 0,
      `${entry.id} endpointTemplate must be non-empty`,
    );
    assert.equal(typeof entry.timeRange, "boolean", `${entry.id} timeRange`);
    assert.equal(typeof entry.maxResults, "number", `${entry.id} maxResults`);
  }

  // Plan Task 1 Step 4: required population of ids.
  const expected = [
    // 6 free engines
    "bing", "ddg", "ddg-lite", "searxng", "mojeek", "firecrawl-keyless",
    // 5 keyed free-tier engines
    "tavily", "serper", "bocha", "exa", "firecrawl-key",
    // 10 stable platforms
    "github", "hackernews", "reddit", "stackoverflow", "wikipedia",
    "v2ex", "npm", "huggingface", "modelscope", "zhihu",
    // 2 verify-tier platforms
    "bilibili", "weibo",
    // 1 best-effort
    "x",
  ];
  for (const id of expected) {
    assert.ok(ids.has(id), `catalog is missing required source id: ${id}`);
  }
  assert.equal(catalog.sources.length, expected.length);
});

test("catalog/trust.v1.json loads and carries the spec §5 seeds", () => {
  const trust = loadJson("../catalog/trust.v1.json") as TrustSpec;
  assert.ok(Array.isArray(trust.officialDomainPatterns));
  assert.ok(Array.isArray(trust.officialAccounts));
  assert.ok(Array.isArray(trust.contentFarmPatterns));
  assert.ok(Array.isArray(trust.satireDomains));
  assert.ok(
    Array.isArray(trust.clickbaitPatterns.zh) &&
      Array.isArray(trust.clickbaitPatterns.en),
    "clickbaitPatterns must have zh + en arrays",
  );

  for (const domain of ["qwen.ai", "deepseek.com", "huggingface.co", "github.com"]) {
    assert.ok(
      trust.officialDomainPatterns.includes(domain),
      `officialDomainPatterns missing ${domain}`,
    );
  }

  const zhPatterns = trust.clickbaitPatterns.zh.join("|");
  for (const token of ["震惊", "炸裂", "速看", "删前快看"]) {
    assert.ok(
      zhPatterns.includes(token),
      `zh clickbait pattern missing ${token}`,
    );
  }

  const enPatterns = trust.clickbaitPatterns.en.join("|").toUpperCase();
  for (const token of ["SHOCKING", "EXPOSED", "YOU WON'T BELIEVE"]) {
    assert.ok(
      enPatterns.includes(token),
      `en clickbait pattern missing ${token}`,
    );
  }
});

test("SourceResult / Gap / Flag shapes accept the projected fields", () => {
  // Structural compile-time guard: the task requires these optional fields
  // to exist on the type (omitted upstream, never defaulted).
  const full: SourceResult = {
    title: "Qwen4-Max released",
    url: "https://qwen.ai/blog",
    snippet: "…",
    date: "2026-10-10",
    author: "Qwen team",
    target: "huggingface",
    trustRank: "A",
    flags: [],
    clusterId: "c3",
    clusterSize: 4,
    votes: 128,
    comments: 30,
  };
  const minimal: SourceResult = {
    title: "t",
    url: "https://x.test/a",
    snippet: "s",
    target: "bing",
    trustRank: normalizeTrust("c"),
    flags: [],
  };

  // Upstream-absent fields stay absent — no defaulted 0 / "" placeholders.
  assert.equal("date" in minimal, false);
  assert.equal("author" in minimal, false);
  assert.equal("votes" in minimal, false);
  assert.equal("comments" in minimal, false);
  assert.equal("clusterId" in minimal, false);
  assert.equal("clusterSize" in minimal, false);
  assert.equal(full.votes, 128);

  const gap: Gap = { target: "x", reason: "HTML 403", status: "unavailable" };
  const gapWithRouting: Gap = {
    target: "web",
    reason: "x syndication empty, web fallback used",
    status: "degraded",
    requestedTarget: "x",
    actualTarget: "web",
  };
  assert.equal(gap.status, "unavailable");
  assert.equal(gapWithRouting.requestedTarget, "x");

  const flag: Flag = "single_source";
  const rank: TrustRank = "B";
  assert.equal(flag, "single_source");
  assert.equal(rank, "B");
});
