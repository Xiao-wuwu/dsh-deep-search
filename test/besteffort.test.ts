import assert from "node:assert/strict";
import test from "node:test";

import { parseBilibili, parseWeiboHtml, parseXSyndication } from "../src/platforms/parsers.ts";
import { verifyTierStatus } from "../src/platforms/besteffort.ts";

/* ---------- bilibili ---------- */

test("parseBilibili: ok response extracts videos; decodes <em> tags", () => {
  const j = JSON.stringify({ code: 0, data: { result: [
    { title: "Qwen4 <em class=\"keyword\">发布</em>实测", bvid: "BV1xx", author: "up1", play: 120000, danmaku: 300, pubdate: 1760000000 },
  ] } });
  const r = parseBilibili(j);
  assert.equal(r.status, "ok");
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0]!.title, "Qwen4 发布实测");
  assert.match(r.hits[0]!.url, /bilibili\.com\/video\/BV1xx/);
  assert.equal(r.hits[0]!.votes, 120000);
});

test("parseBilibili: risk-control code -352 → empty + note (never throws)", () => {
  const r = parseBilibili(JSON.stringify({ code: -352, message: "风控" }));
  assert.equal(r.status, "failed");
  assert.equal(r.hits.length, 0);
  assert.match(r.note ?? "", /-352/);
});

test("parseBilibili: garbage JSON → failed, no crash", () => {
  const r = parseBilibili("<html>blocked</html>");
  assert.equal(r.status, "failed");
});

/* ---------- weibo ---------- */

test("parseWeiboHtml: cards extracted", () => {
  const html = `<div class="card-wrap" mid="bus_6600_a"><div class="content">
    <div class="info"><div class="from">作者：<a href="/u/123">AI实验室</a> 10月10日 来自 微博网页版</div></div>
    <p class="txt">Qwen4 开源了，权重同步发布。</p>
  </div></div>`;
  const r = parseWeiboHtml(html);
  assert.equal(r.status, "ok");
  assert.equal(r.hits.length, 1);
  assert.match(r.hits[0]!.snippet, /Qwen4 开源/);
  assert.equal(r.hits[0]!.author, "AI实验室");
  const year = new Date().getFullYear();
  assert.equal(r.hits[0]!.date, `${year}-10-10`);
});

test("parseWeiboHtml: passport/login wall → failed with note", () => {
  const r = parseWeiboHtml(`<script>window._sweibo_errlist = ["Passport Weibo"];</script>`);
  assert.equal(r.status, "failed");
  assert.match(r.note ?? "", /login wall/);
});

test("parseWeiboHtml: empty page → ok with 0 hits (adapter downgrades to unavailable)", () => {
  const r = parseWeiboHtml("<html><body>no cards</body></html>");
  assert.equal(r.status, "ok");
  assert.equal(r.hits.length, 0);
});

/* ---------- x syndication ---------- */

test("parseXSyndication: tweets extracted w/ likes→votes", () => {
  const j = JSON.stringify({
    timeline: { instructions: [{ entries: [
      { content: { itemContent: { tweet: {
        text: "Releasing Qwen4 weights tomorrow",
        userName: "qwenlm", userId_str: "1", likes: 5000, createdAt: "2026-10-09T12:00:00.000Z",
        conversation: { id: "111" },
      } } } },
    ] }] },
  });
  const r = parseXSyndication(j);
  assert.equal(r.status, "ok");
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0]!.author, "qwenlm");
  assert.match(r.hits[0]!.url, /x\.com\/qwenlm\/status\/111/);
  assert.equal(r.hits[0]!.votes, 5000);
});

test("parseXSyndication: empty timeline → unavailable (never pretend)", () => {
  const r = parseXSyndication(JSON.stringify({ timeline: { instructions: [{ entries: [] }] } }));
  assert.equal(r.status, "unavailable");
  assert.match(r.note ?? "", /empty/);
});

test("verifyTierStatus maps codes", () => {
  assert.equal(verifyTierStatus("ok"), "ok");
  assert.equal(verifyTierStatus("failed"), "failed");
});
