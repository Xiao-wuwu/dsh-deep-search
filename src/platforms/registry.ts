/** Platform registry: HTTP factories for the 10 stable platforms + buildPlatforms().
 *  Adapters are thin (endpoint build → GET/POST → tested parser), so all live in
 *  this one focused file instead of 10 near-identical modules (plan deviation, noted). */
import type { EngineDeps } from "../engines/types.ts";
import type { PlatformHit } from "./parsers.ts";
import {
  parseGithub, parseHackernews, parseReddit, parseStackoverflow, parseWikipedia,
  parseNpm, parseHuggingface, parseModelscope, parseV2ex, parseZhihu,
} from "./parsers.ts";
import { HttpError } from "../http/client.ts";
import { QuotaError } from "../engines/types.ts";

export interface Platform {
  id: string;
  search(query: string, opts?: { timeRange?: string; maxResults?: number; signal?: AbortSignal }): Promise<PlatformHit[]>;
}

export interface PlatformConfig {
  enabled: string[];
  proxyByTarget?: Record<string, string>;
}

const enc = encodeURIComponent;
const clamp = (n: number | undefined, max: number): number => Math.max(1, Math.min(Math.trunc(n ?? 8), max));

const sinceI = (timeRange?: string): number | undefined => {
  const days: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
  const d = timeRange && days[timeRange];
  return d ? Math.floor(Date.now() / 1000) - d * 86400 : undefined;
};

type GetParse = (q: string, o: { timeRange?: string; n: number }) => { url: string; headers?: Record<string, string> };

function simplePlatform(id: string, build: GetParse, parse: (body: string) => PlatformHit[]): (deps: EngineDeps) => Platform {
  return (deps) => ({
    id,
    async search(query, o = {}) {
      const n = clamp(o.maxResults, 15);
      const key = `${id}|${query}|${o.timeRange ?? ""}|${n}`;
      const cached = deps.cache?.get(key) as PlatformHit[] | undefined;
      if (cached) return cached;
      if (deps.cooldown.touched(id)) throw new QuotaError(id, `${id} is cooling`);
      if (deps.bucket && !deps.bucket.tryConsume()) throw new QuotaError(id, `local rate limit for ${id}`);
      const spec = build(query, { timeRange: o.timeRange, n });
      try {
        const res = await deps.http.get(spec.url, { target: id, seed: `${id}${query}`, headers: spec.headers, signal: o.signal });
        const out = parse(res.body).slice(0, n);
        deps.cache?.set(key, out);
        return out;
      } catch (err) {
        if (err instanceof HttpError && err.isQuota) { deps.cooldown.mark(id, 15); }
        throw err;
      }
    },
  });
}

const github = simplePlatform("github", (q, { n }) => ({
  url: `https://api.github.com/search/repositories?q=${enc(q)}&per_page=${n}&sort=updated`,
  headers: { accept: "application/vnd.github+json" },
}), parseGithub);

const hackernews = simplePlatform("hackernews", (q, { timeRange, n }) => {
  const since = sinceI(timeRange);
  let url = `https://hn.algolia.com/api/v1/search?query=${enc(q)}&hitsPerPage=${n}`;
  if (since) url += `&numericFilters=created_at_i%3E${since}`;
  return { url };
}, parseHackernews);

const reddit = simplePlatform("reddit", (q, { timeRange, n }) => {
  const t = ["day", "week", "month", "year"].includes(timeRange ?? "") ? timeRange : "all";
  return {
    url: `https://www.reddit.com/search.json?q=${enc(q)}&sort=top&t=${t}&limit=${n}&raw_json=1`,
    headers: { "user-agent": "dsh-deep-search/0.1 (research plugin)" },
  };
}, parseReddit);

const stackoverflow = simplePlatform("stackoverflow", (q, { timeRange, n }) => {
  let url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${enc(q)}&pagesize=${n}&site=stackoverflow&filter=withbody`;
  const since = sinceI(timeRange);
  if (since) url += `&fromdate=${since}`;
  return { url, headers: { accept: "application/json" } };
}, parseStackoverflow);

const wikipedia = simplePlatform("wikipedia", (q, { n }) => ({
  url: `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${enc(q)}&gsrlimit=${n}&prop=extracts|info&exintro&explaintext&exlimit=${n}&format=json&redirects=1`,
}), parseWikipedia);

const npm = simplePlatform("npm", (q, { n }) => ({
  url: `https://registry.npmjs.org/-/v1/search?text=${enc(q)}&size=${n}`,
}), parseNpm);

const huggingface = simplePlatform("huggingface", (q, { n }) => ({
  url: `https://huggingface.co/api/models?search=${enc(q)}&sort=lastModified&direction=-1&limit=${n}`,
}), parseHuggingface);

const modelscope = simplePlatform("modelscope", (q, { n }) => ({
  url: `https://www.modelscope.cn/api/v1/models?Query=${enc(q)}&SortBy=GmtModified&PageSize=${n}&PageNumber=1`,
}), parseModelscope);

const v2ex = simplePlatform("v2ex", (q, { n }) => ({
  url: `https://www.v2ex.com/api/topics/search.json?q=${enc(q)}&n=${n}`,
}), parseV2ex);

const zhihu = (deps: EngineDeps, secret: string): Platform => ({
  id: "zhihu",
  async search(query, o = {}) {
    const n = clamp(o.maxResults, 15);
    const key = `zhihu|${query}|${o.timeRange ?? ""}|${n}`;
    const cached = deps.cache?.get(key) as PlatformHit[] | undefined;
    if (cached) return cached;
    if (deps.cooldown.touched("zhihu")) throw new QuotaError("zhihu", "zhihu is cooling");
    if (deps.bucket && !deps.bucket.tryConsume()) throw new QuotaError("zhihu", "local rate limit for zhihu");
    const u = new URL("https://developer.zhihu.com/api/search/content");
    u.searchParams.set("query", query);
    u.searchParams.set("size", String(n));
    u.searchParams.set("content_types[]", "answer");
    u.searchParams.set("content_types[]", "article");
    try {
      const res = await deps.http.get(u.toString(), {
        target: "zhihu", seed: `zhihu${query}`,
        headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
        signal: o.signal,
      });
      const out = parseZhihu(res.body).slice(0, n);
      deps.cache?.set(key, out);
      return out;
    } catch (err) {
      if (err instanceof HttpError && err.isQuota) deps.cooldown.mark("zhihu", 15);
      throw err;
    }
  },
});

export interface BuildPlatformsResult {
  active: Platform[];
  disabled: { id: string; reason: string }[];
}

const SIMPLE: Record<string, (deps: EngineDeps) => Platform> = {
  github, hackernews, reddit, stackoverflow, wikipedia, npm, huggingface, modelscope, v2ex,
};

export function buildPlatforms(cfg: PlatformConfig, creds: Map<string, string>, deps: EngineDeps): BuildPlatformsResult {
  const active: Platform[] = [];
  const disabled: { id: string; reason: string }[] = [];
  for (const id of cfg.enabled) {
    if (id === "zhihu") {
      const secret = creds.get("zhihu") ?? creds.get("ZHIHU_ACCESS_SECRET");
      if (!secret) { disabled.push({ id, reason: "missing credential for zhihu (ref: ZHIHU_ACCESS_SECRET) — stable tier requires the Open Platform Access Secret" }); continue; }
      active.push(zhihu(deps, secret));
      continue;
    }
    const make = SIMPLE[id];
    if (make) { active.push(make(deps)); continue; }
    disabled.push({ id, reason: `unknown platform id: ${id}` });
  }
  return { active, disabled };
}

export function platformById(id: string, active: Platform[]): Platform | undefined {
  return active.find((p) => p.id === id);
}
