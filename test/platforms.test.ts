import assert from "node:assert/strict";
import test from "node:test";

import {
  parseGithub, parseHackernews, parseReddit, parseStackoverflow, parseWikipedia,
  parseNpm, parseHuggingface, parseModelscope, parseV2ex, parseZhihu,
} from "../src/platforms/parsers.ts";
import { buildPlatforms } from "../src/platforms/registry.ts";
import { Cooldown } from "../src/http/limits.ts";
import { createHttpClient } from "../src/http/client.ts";

test("parseGithub: repos with honest date/author", () => {
  const j = JSON.stringify({ items: [
    { full_name: "QwenLM/Qwen3", html_url: "https://github.com/QwenLM/Qwen3", description: "Qwen LLM", updated_at: "2026-10-11T08:00:00Z", owner: { login: "QwenLM" } },
    { full_name: "x/y", html_url: "https://github.com/x/y", description: null },
  ], total_count: 2 });
  const hits = parseGithub(j);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]!.title, "QwenLM/Qwen3");
  assert.equal(hits[0]!.url, "https://github.com/QwenLM/Qwen3");
  assert.equal(hits[0]!.date, "2026-10-11");
  assert.equal(hits[0]!.author, "QwenLM");
  assert.equal("date" in hits[1]!, false, "absent date omitted");
});

test("parseHackernews: url falls back to item page; points→votes", () => {
  const j = JSON.stringify({ hits: [
    { title: "Qwen4 released", url: "https://qwen.ai/blog", objectID: "123", points: 450, num_comments: 120, created_at: "2026-10-10T00:00:00Z", author: "swyx" },
    { title: "Ask HN: rumor?", objectID: "456", points: null, num_comments: 3, created_at: "2026-10-09T00:00:00Z" },
  ] });
  const hits = parseHackernews(j);
  assert.equal(hits[0]!.url, "https://qwen.ai/blog");
  assert.equal(hits[1]!.url, "https://news.ycombinator.com/item?id=456");
  assert.equal(hits[0]!.votes, 450);
  assert.equal("votes" in hits[1]!, false, "null points omitted, not 0");
});

test("parseReddit: permalink→abs url, score→votes", () => {
  const j = JSON.stringify({ data: { children: [
    { data: { title: "Qwen4??", permalink: "/r/LocalLLaMA/comments/abc/x/", selftext: "weights dropped", created_utc: 1760000000, author: "u1", score: 900, num_comments: 200, subreddit: "LocalLLaMA" } },
    { data: { title: "no body", permalink: "/r/x/comments/y/", author: null, score: 0, num_comments: 0, created_utc: 1759000000 } },
  ] } });
  const hits = parseReddit(j);
  assert.equal(hits[0]!.url, "https://www.reddit.com/r/LocalLLaMA/comments/abc/x/");
  assert.equal(hits[0]!.votes, 900);
  assert.equal(hits[0]!.author, "u1");
  assert.equal("author" in hits[1]!, false, "null author omitted");
  assert.equal(hits[1]!.votes, 0, "explicit 0 from upstream is kept");
});

test("parseStackoverflow: link/date/score", () => {
  const j = JSON.stringify({ items: [
    { title: "How to run Qwen4?", link: "https://stackoverflow.com/q/1", score: 12, answer_count: 3, creation_date: 1759999999, excerpt: "body…" },
  ] });
  const hits = parseStackoverflow(j);
  assert.equal(hits[0]!.url, "https://stackoverflow.com/q/1");
  assert.equal(hits[0]!.votes, 12);
  assert.equal(hits[0]!.comments, 3);
});

test("parseWikipedia: page extracts", () => {
  const j = JSON.stringify({ query: { pages: {
    "1": { title: "Qwen", extract: "Qwen is an LLM family.", index: 1 },
    "2": { title: "DeepSeek", extract: "DeepSeek is a lab.", index: 2 },
  } } });
  const hits = parseWikipedia(j);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]!.title, "Qwen");
  assert.match(hits[0]!.url, /wikipedia\.org\/wiki\/Qwen/);
});

test("parseNpm: package search", () => {
  const j = JSON.stringify({ objects: [
    { package: { name: "qwen-sdk", version: "1.2.3", description: "SDK", date: "2026-10-01T00:00:00Z", publisher: { username: "qwenlm" } }, score: { final: 100 } },
  ] });
  const hits = parseNpm(j);
  assert.equal(hits[0]!.title, "qwen-sdk 1.2.3");
  assert.match(hits[0]!.url, /npmjs\.com\/package\/qwen-sdk/);
  assert.equal(hits[0]!.author, "qwenlm");
});

test("parseHuggingface: model cards with id/date", () => {
  const j = JSON.stringify([
    { modelId: "Qwen/Qwen4-Max", id: "Qwen/Qwen4-Max", author: "Qwen", lastModified: "2026-10-10T00:00:00Z", downloads: 5000, tags: ["text-generation"] },
  ]);
  const hits = parseHuggingface(j);
  assert.equal(hits[0]!.url, "https://huggingface.co/Qwen/Qwen4-Max");
  assert.equal(hits[0]!.date, "2026-10-10");
  assert.equal(hits[0]!.votes, 5000, "downloads as popularity signal");
});

test("parseModelscope: real PUT shape {Data:{Models:[…]}}, URL=/models/<Path>/<Name>", () => {
  const j = JSON.stringify({ Code: 200, Data: { Models: [
    { Name: "Qwen4-Max", Path: "Qwen", Description: "旗舰模型", LastUpdatedTime: 1791994177, Downloads: 999, CreatedBy: "QwenTeam" },
  ] } });
  const hits = parseModelscope(j);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.title, "Qwen4-Max");
  assert.equal(hits[0]!.url, "https://www.modelscope.cn/models/Qwen/Qwen4-Max");
  assert.equal(hits[0]!.votes, 999);
});

test("parseModelscope: legacy/alternate envelope still tolerated", () => {
  const j = JSON.stringify({ data: { models: [{ Name: "X", Path: "o", Description: "d" }] } });
  const hits = parseModelscope(j);
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.url, /modelscope\.cn\/models\/o\/X/);
});

test("parseV2ex: topic list", () => {
  const j = JSON.stringify([
    { title: "Qwen4 发布了吗", url: "https://www.v2ex.com/t/123", content: "听说…", created: 1760000000, member: { username: "dev1" }, replies: 42 },
  ]);
  const hits = parseV2ex(j);
  assert.equal(hits[0]!.title, "Qwen4 发布了吗");
  assert.equal(hits[0]!.comments, 42);
});

test("parseZhihu: official-API shape; malformed → []", () => {
  const j = JSON.stringify({ data: { items: [
    { title: "如何评价 Qwen4", url: "https://www.zhihu.com/question/1", excerpt: "刚看到公告", created_time: 1760000000, author: { name: "Z" }, voteup_count: 300, comment_count: 40 },
  ] } });
  const hits = parseZhihu(j);
  assert.equal(hits[0]!.votes, 300);
  assert.deepEqual(parseZhihu("not json"), []);
});

test("buildPlatforms: zhihu needs credential; disabled list explains; order kept", () => {
  const cfg = { enabled: ["github", "zhihu"] };
  const deps = { http: createHttpClient(), cooldown: new Cooldown() };
  const r1 = buildPlatforms(cfg, new Map(), deps);
  assert.deepEqual(r1.active.map((p) => p.id), ["github"]);
  assert.ok(r1.disabled.some((d) => d.id === "zhihu" && /credential/i.test(d.reason)));
  const r2 = buildPlatforms(cfg, new Map([["zhihu", "sec"]]), deps);
  assert.deepEqual(r2.active.map((p) => p.id), ["github", "zhihu"]);
  const r3 = buildPlatforms({ enabled: ["nope"] }, new Map(), deps);
  assert.equal(r3.disabled[0]!.reason, "unknown platform id: nope");
});
