/** 诊断抓取：每平台记录 status + 响应前 400 字符 + 解析 hits 数。
 *  仅输出摘要到 stdout（省 token），完整响应落 test/fixtures/diag/。 */
import { request } from "undici";
import { writeFileSync, mkdirSync } from "node:fs";
import { parseBing, parseDdg, parseMojeek } from "../src/engines/html.ts";
import { parseGithub, parseModelscope, parseHuggingface } from "../src/platforms/parsers.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
mkdirSync("test/fixtures/diag", { recursive: true });
const q = "Qwen";
const targets = [
  ["bing-html", `https://www.bing.com/search?q=${encodeURIComponent("Qwen model release")}&count=10`, parseBing],
  ["github-search", `https://api.github.com/search/repositories?q=${q}&per_page=5&sort=updated`, parseGithub],
  ["github-repos-list", `https://api.github.com/orgs/QwenLM/repos?sort=updated&per_page=5`, (t) => { const j = JSON.parse(t); return Array.isArray(j) ? j.map((x) => ({ title: x.full_name, url: x.html_url, snippet: x.description ?? "" })) : []; }],
  ["modelscope-A", `https://www.modelscope.cn/api/v1/models?Query=${q}&SortBy=GmtModified&PageSize=5&PageNumber=1`, parseModelscope],
  ["modelscope-B", `https://www.modelscope.cn/api/v1/dolphin/models?Query=${q}&PageSize=5`, parseModelscope],
  ["hf-search", `https://huggingface.co/api/models?search=${q}&limit=5`, parseHuggingface],
  ["ddg-lite", `https://lite.duckduckgo.com/lite/?q=${q}`, parseDdg],
];

for (const [name, url, parse] of targets) {
  try {
    const res = await request(url, {
      headers: { "user-agent": UA, accept: "text/html,application/json;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" },
      headersTimeout: 15000, bodyTimeout: 15000, signal: AbortSignal.timeout(15000),
    });
    const body = await res.body.text();
    writeFileSync(`test/fixtures/diag/${name}.json`, JSON.stringify({ url, status: res.statusCode, headers: res.headers, body: body.slice(0, 200000) }, null, 1));
    let parsed = [];
    let err = "";
    try { parsed = parse(body); } catch (e) { err = String(e).slice(0, 80); }
    console.log(`${name.padEnd(18)} ${res.statusCode} len=${String(body.length).padStart(7)} hits=${parsed.length}${err ? ` PARSE_ERR=${err}` : ""}`);
    if (parsed.length) console.log(`   first: ${JSON.stringify(parsed[0]).slice(0, 160)}`);
  } catch (e) {
    console.log(`${name.padEnd(18)} FETCH_ERR ${String((e as Error).message).slice(0, 90)}`);
  }
}
