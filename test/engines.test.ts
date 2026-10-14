import assert from "node:assert/strict";
import test from "node:test";

import { parseBing, parseDdg, parseMojeek } from "../src/engines/html.ts";
import { parseSearxngJson, parseApiJson } from "../src/engines/api.ts";
import { buildEngines } from "../src/engines/registry.ts";
import { Cooldown } from "../src/http/limits.ts";
import { createHttpClient } from "../src/http/client.ts";

const b64u = (s: string) => Buffer.from(s).toString("base64url");

/* ---------------- HTML engine parsers (fixture replay) ---------------- */

test("parseBing: extracts title/url/snippet and decodes ck/a redirects", () => {
  const target = "https://qwen.ai/blog/qwen4";
  const html = `<html><body><ol id="b_results">
    <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&&p=xx&u=a1${b64u(target)}&ntb=1">Qwen4 released</a></h2>
      <div class="b_caption"><p>Official blog post announcing Qwen4-Max.</p></div></li>
    <li class="b_algo"><h2><a href="https://example.org/plain">Plain link result</a></h2>
      <div class="b_caption"><p>Second result.</p></div></li>
    <li class="b_ans">AD slot must be ignored</li>
  </ol></body></html>`;
  const hits = parseBing(html);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]!.title, "Qwen4 released");
  assert.equal(hits[0]!.url, target);
  assert.match(hits[0]!.snippet, /Official blog post/);
  assert.equal(hits[1]!.url, "https://example.org/plain");
});

test("parseDdg: decodes uddg redirect, keeps direct links, skips ads", () => {
  const html = `<body>
    <div class="result results_links">
      <div class="result__body">
        <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Freddit.com%2Fr%2FLocalLLaMA%2Fcomments%2Fabc&rut=deadbeef">Qwen4 on Reddit</a>
        <a class="result__snippet">Users report weights arrived.</a>
      </div></div>
    <div class="result results_links">
      <div class="result__body">
        <a class="result__a" href="https://deepseek.com/news">Direct link result</a>
        <a class="result__snippet">Snippet two.</a>
      </div></div>
    <div class="result--ad"><a class="result__a" href="https://ads.example/x">Ad</a></div>
  </body>`;
  const hits = parseDdg(html);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]!.url, "https://reddit.com/r/LocalLLaMA/comments/abc");
  assert.equal(hits[1]!.url, "https://deepseek.com/news");
  assert.equal(hits[0]!.snippet, "Users report weights arrived.");
});

test("parseMojeek: standard result list", () => {
  const html = `<ul class="results-standard">
    <li><h3><a href="https://hn.algolia.com/item/1">HN thread</a></h3><p class="s">Discussion about launch.</p></li>
    <li><h3><a href="https://modelscope.cn/models/AI-ModelScope/qwen4">ModelScope page</a></h3><p class="s">Model card.</p></li>
  </ul>`;
  const hits = parseMojeek(html);
  assert.equal(hits.length, 2);
  assert.equal(hits[1]!.title, "ModelScope page");
  assert.equal(hits[0]!.snippet, "Discussion about launch.");
});

/* ---------------- JSON API parsers ---------------- */

test("parseSearxngJson: maps results + published dates", () => {
  const json = JSON.stringify({
    results: [
      { title: "A", url: "https://a.test/1", content: "snippet a", publishedDate: "2026-10-10T00:00:00Z" },
      { title: "B", url: "https://b.test/2", content: "snippet b" },
    ],
  });
  const hits = parseSearxngJson(json);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]!.date, "2026-10-10");
  assert.equal(hits[1]!.date, undefined, "absent date stays absent — never defaulted");
});

test("parseApiJson: tavily-style web_results + firecrawl-style data.web", () => {
  const tavily = JSON.stringify({
    results: [
      { title: "T1", url: "https://t.test/1", content: "cv1", published_date: "2026-10-11" },
    ],
  });
  assert.deepEqual(parseApiJson(tavily, "tavily"), [
    { title: "T1", url: "https://t.test/1", snippet: "cv1", date: "2026-10-11" },
  ]);
  const firecrawl = JSON.stringify({ data: { web: [{ title: "F", url: "https://f.test", snippet: "fs" }] } });
  assert.equal(parseApiJson(firecrawl, "firecrawl")[0]!.url, "https://f.test");
  const serper = JSON.stringify({ organic: [{ title: "S", link: "https://s.test", snippet: "ss", date: "2026-01-02" }] });
  assert.equal(parseApiJson(serper, "serper")[0]!.date, "2026-01-02");
  // malformed → empty, never throw
  assert.deepEqual(parseApiJson("{not json", "tavily"), []);
});

/* ---------------- registry ---------------- */

const deps = { http: createHttpClient(), cooldown: new Cooldown() };

test("buildEngines: keyed engines activate only with credentials", () => {
  const cfg = { enabled: ["bing", "ddg", "tavily", "serper"], searxngInstances: [] };
  const { active, disabled } = buildEngines(cfg, new Map([["tavily", "tv-key"]]), deps);
  const ids = active.map((e) => e.id);
  assert.ok(ids.includes("bing") && ids.includes("ddg") && ids.includes("tavily"));
  assert.ok(!ids.includes("serper"));
  assert.ok(disabled.some((d) => d.id === "serper" && /credential/i.test(d.reason)));
});

test("buildEngines: unknown/disabled ids excluded; order follows config", () => {
  const cfg = { enabled: ["ddg", "bing"], searxngInstances: [] };
  const { active } = buildEngines(cfg, new Map(), deps);
  assert.deepEqual(active.map((e) => e.id), ["ddg", "bing"]);
});
