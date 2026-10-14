/** Engine registry: factories for all engines + buildEngines() honoring config & credentials.
 *  Deviation from plan Task 3 (one file per engine): factories are thin wrappers over the
 *  already-tested parsers in html.ts/api.ts; keeping them here is one focused, testable file. */
import { HttpError } from "../http/client.ts";
import { QuotaError, type Engine, type EngineConfig, type EngineDeps, type EngineHit } from "./types.ts";
import { parseRss, parseDdg, parseMojeek } from "./html.ts";
import { parseSearxngJson, parseApiJson } from "./api.ts";

type Factory = (deps: EngineDeps, cfg: EngineConfig) => Engine;

const COOLDOWN_MIN = 15;

/** Quota-shaped failures park the engine at the back of the chain (cooldown), never drop it. */
function wrapError(err: unknown, id: string, deps: EngineDeps): never {
  if (err instanceof HttpError && err.isQuota) {
    deps.cooldown.mark(id, COOLDOWN_MIN);
    throw new QuotaError(id, err.message);
  }
  throw err;
}

const enc = encodeURIComponent;
const clamp = (n: number | undefined, max: number): number =>
  Math.max(1, Math.min(Math.trunc(n ?? 8), max));

/* ---------- time-range maps (best-effort per engine; verified in Task 12 smoke) ---------- */
const DDG_T: Record<string, string> = { day: "d", week: "w", month: "m", year: "y" };
const SEARXNG_T: Record<string, string> = { day: "day", week: "month", month: "month", year: "year" };
const SERPER_T: Record<string, string> = { day: "qdr:d", week: "qdr:w", month: "qdr:m", year: "qdr:y" };
const TAVILY_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
const BOCHA_FRESH: Record<string, string> = { day: "oneDay", week: "oneWeek", month: "oneMonth", year: "oneYear" };

/* ---------- HTML engines ---------- */

function htmlEngine(id: string, buildUrl: (q: string, o: { timeRange?: string; n: number }) => string, parse: (body: string) => EngineHit[]): Factory {
  return (deps) => ({
    id,
    timeRange: true,
    async search(query, opts = {}) {
      const key = `${id}|${query}|${opts.timeRange ?? ""}`;
      const cached = deps.cache?.get(key) as EngineHit[] | undefined;
      if (cached) return cached;
      if (deps.cooldown.touched(id)) throw new QuotaError(id, `${id} is cooling`);
      if (deps.bucket && !deps.bucket.tryConsume()) throw new QuotaError(id, `local rate limit for ${id}`);
      const url = buildUrl(query, { timeRange: opts.timeRange, n: clamp(opts.maxResults, 15) });
      let hits: EngineHit[];
      try {
        const res = await deps.http.get(url, { target: id, seed: `${id}${query}`, signal: opts.signal });
        hits = parse(res.body);
      } catch (err) {
        wrapError(err, id, deps);
      }
      const out = hits.slice(0, clamp(opts.maxResults, 15));
      deps.cache?.set(key, out);
      return out;
    },
  });
}

const bing = htmlEngine("bing", (q, { timeRange, n }) => {
  // learned from dsh-web-search-pro's built-in engine: the RSS endpoint is anonymous
  // and stable (HTML scraping fights 302→cn.bing + gzip + bot checks). `format=rss`
  // supports count; freshness only via query operators, so we do not fake timeRange here.
  void timeRange;
  return `https://www.bing.com/search?q=${enc(q)}&format=rss&count=${Math.min(n, 20)}`;
}, parseRss);

const ddgHtml = htmlEngine("ddg", (q, { timeRange, n }) => {
  let url = `https://html.duckduckgo.com/html/?q=${enc(q)}&kl=wt-wt`;
  const d = timeRange && DDG_T[timeRange];
  if (d) url += `&df=${d}`;
  void n;
  return url;
}, parseDdg);

const ddgLite = htmlEngine("ddg-lite", (q, { timeRange }) => {
  let url = `https://lite.duckduckgo.com/lite/?q=${enc(q)}`;
  const d = timeRange && DDG_T[timeRange];
  if (d) url += `&df=${d}`;
  return url;
}, parseDdg);

const mojeek = htmlEngine("mojeek", (q) => `https://www.mojeek.com/search?q=${enc(q)}`, parseMojeek);

/* ---------- searxng (instance rotation) ---------- */

const DEFAULT_SEARXNG: readonly string[] = [
  "https://searx.be", "https://search.brave.tk", "https://searxng.world", "https://priv.au", "https://searx.tiekoetter.com",
];

const searxng: Factory = (deps, cfg) => {
  const instances = (cfg.searxngInstances.length ? cfg.searxngInstances : DEFAULT_SEARXNG).filter(Boolean);
  let cursor = 0;
  return {
    id: "searxng",
    timeRange: true,
    async search(query, opts = {}) {
      const key = `searxng|${query}|${opts.timeRange ?? ""}`;
      const cached = deps.cache?.get(key) as EngineHit[] | undefined;
      if (cached) return cached;
      if (deps.cooldown.touched("searxng")) throw new QuotaError("searxng", "searxng is cooling");
      const errors: string[] = [];
      for (let i = 0; i < Math.min(3, instances.length); i++) {
        const inst = instances[cursor++ % instances.length]!;
        let url = `${inst.replace(/\/$/, "")}/search?q=${enc(query)}&format=json`;
        const t = opts.timeRange && SEARXNG_T[opts.timeRange];
        if (t) url += `&time_range=${t}`;
        try {
          const res = await deps.http.get(url, { target: "searxng", seed: `${inst}${query}`, signal: opts.signal, timeoutMs: 10_000 });
          const hits = parseSearxngJson(res.body).slice(0, clamp(opts.maxResults, 15));
          deps.cache?.set(key, hits);
          return hits;
        } catch (err) {
          if (err instanceof HttpError && err.isQuota) errors.push(`${inst}: quota`);
          else if ((err as Error).name === "AbortError" && opts.signal?.aborted) throw err;
          else errors.push(`${inst}: ${String((err as Error).message).slice(0, 80)}`);
        }
      }
      deps.cooldown.mark("searxng", COOLDOWN_MIN);
      throw new QuotaError("searxng", `all searxng instances failed (${errors.join("; ")})`);
    },
  };
};

/* ---------- JSON engines (POST) — real factories below carry the credential in closure ---------- */

function tavilyFactory(key: string): Factory {
  return (deps) => ({
    id: "tavily", timeRange: true,
    async search(query, o = {}) {
      const k = `tavily|${query}|${o.timeRange ?? ""}`;
      const cached = deps.cache?.get(k) as EngineHit[] | undefined;
      if (cached) return cached;
      if (deps.cooldown.touched("tavily")) throw new QuotaError("tavily", "tavily is cooling");
      const body: Record<string, unknown> = { query, max_results: clamp(o.maxResults, 15), include_answer: false, search_depth: "basic" };
      if (o.timeRange && TAVILY_DAYS[o.timeRange]) body.days = TAVILY_DAYS[o.timeRange];
      let hits: EngineHit[];
      try {
        const res = await deps.http.post("https://api.tavily.com/search", {
          target: "tavily", seed: `tavily${query}`,
          headers: { authorization: `Bearer ${key}` },
          body: JSON.stringify(body), signal: o.signal,
        });
        hits = parseApiJson(res.body, "tavily");
      } catch (err) { wrapError(err, "tavily", deps); }
      const out = hits.slice(0, clamp(o.maxResults, 15));
      deps.cache?.set(k, out);
      return out;
    },
  });
}

function serperFactory(key: string): Factory {
  return (deps) => ({
    id: "serper", timeRange: true,
    async search(query, o = {}) {
      const k = `serper|${query}|${o.timeRange ?? ""}`;
      const cached = deps.cache?.get(k) as EngineHit[] | undefined;
      if (cached) return cached;
      if (deps.cooldown.touched("serper")) throw new QuotaError("serper", "serper is cooling");
      const body: Record<string, unknown> = { q: query, num: clamp(o.maxResults, 15) };
      if (o.timeRange && SERPER_T[o.timeRange]) body.tbs = SERPER_T[o.timeRange];
      let hits: EngineHit[];
      try {
        const res = await deps.http.post("https://google.serper.dev/search", {
          target: "serper", seed: `serper${query}`,
          headers: { "x-api-key": key }, body: JSON.stringify(body), signal: o.signal,
        });
        hits = parseApiJson(res.body, "serper");
      } catch (err) { wrapError(err, "serper", deps); }
      const out = hits.slice(0, clamp(o.maxResults, 15));
      deps.cache?.set(k, out);
      return out;
    },
  });
}

function bochaFactory(key: string): Factory {
  return (deps) => ({
    id: "bocha", timeRange: true,
    async search(query, o = {}) {
      const k = `bocha|${query}|${o.timeRange ?? ""}`;
      const cached = deps.cache?.get(k) as EngineHit[] | undefined;
      if (cached) return cached;
      if (deps.cooldown.touched("bocha")) throw new QuotaError("bocha", "bocha is cooling");
      const body: Record<string, unknown> = { query, count: clamp(o.maxResults, 15), summary: true };
      if (o.timeRange && BOCHA_FRESH[o.timeRange]) body.freshness = BOCHA_FRESH[o.timeRange];
      let hits: EngineHit[];
      try {
        const res = await deps.http.post("https://api.bochaai.com/v1/web-search", {
          target: "bocha", seed: `bocha${query}`,
          headers: { authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: o.signal,
        });
        hits = parseApiJson(res.body, "bocha");
      } catch (err) { wrapError(err, "bocha", deps); }
      const out = hits.slice(0, clamp(o.maxResults, 15));
      deps.cache?.set(k, out);
      return out;
    },
  });
}

function exaFactory(key: string): Factory {
  return (deps) => ({
    id: "exa", timeRange: false,
    async search(query, o = {}) {
      const k = `exa|${query}|`;
      const cached = deps.cache?.get(k) as EngineHit[] | undefined;
      if (cached) return cached;
      if (deps.cooldown.touched("exa")) throw new QuotaError("exa", "exa is cooling");
      let hits: EngineHit[];
      try {
        const res = await deps.http.post("https://api.exa.ai/search", {
          target: "exa", seed: `exa${query}`,
          headers: { "x-api-key": key },
          body: JSON.stringify({ query, numResults: clamp(o.maxResults, 15), type: "auto", livecrawl: "never" }),
          signal: o.signal,
        });
        hits = parseApiJson(res.body, "exa");
      } catch (err) { wrapError(err, "exa", deps); }
      const out = hits.slice(0, clamp(o.maxResults, 15));
      deps.cache?.set(k, out);
      return out;
    },
  });
}

function firecrawlFactory(key: string | undefined): Factory {
  return (deps) => ({
    id: key ? "firecrawl-key" : "firecrawl-keyless", timeRange: false,
    async search(query, o = {}) {
      const id = key ? "firecrawl-key" : "firecrawl-keyless";
      const k = `${id}|${query}|`;
      const cached = deps.cache?.get(k) as EngineHit[] | undefined;
      if (cached) return cached;
      if (deps.cooldown.touched(id)) throw new QuotaError(id, `${id} is cooling`);
      let hits: EngineHit[];
      try {
        const res = await deps.http.post("https://api.firecrawl.dev/v1/search", {
          target: id, seed: `${id}${query}`,
          headers: key ? { authorization: `Bearer ${key}` } : {},
          body: JSON.stringify({ query, limit: clamp(o.maxResults, 10) }),
          signal: o.signal,
        });
        hits = parseApiJson(res.body, "firecrawl");
      } catch (err) { wrapError(err, id, deps); }
      const out = hits.slice(0, clamp(o.maxResults, 10));
      deps.cache?.set(k, out);
      return out;
    },
  });
}

/* ---------- registry ---------- */

const FREE_FACTORIES: Record<string, Factory> = {
  bing, ddg: ddgHtml, "ddg-lite": ddgLite, searxng, mojeek,
  "firecrawl-keyless": firecrawlFactory(undefined),
};

const KEYED: Record<string, { refs: string[]; make: (key: string) => Factory }> = {
  tavily: { refs: ["tavily", "TAVILY_API_KEY"], make: tavilyFactory },
  serper: { refs: ["serper", "SERPER_API_KEY"], make: serperFactory },
  bocha: { refs: ["bocha", "BOCHA_API_KEY"], make: bochaFactory },
  exa: { refs: ["exa", "EXA_API_KEY"], make: exaFactory },
  "firecrawl-key": { refs: ["firecrawl-key", "firecrawl", "FIRECRAWL_API_KEY"], make: (k) => firecrawlFactory(k) },
};

export interface BuildEnginesResult {
  active: Engine[];
  disabled: { id: string; reason: string }[];
}

export function buildEngines(
  cfg: EngineConfig,
  creds: Map<string, string>,
  deps: EngineDeps,
): BuildEnginesResult {
  const active: Engine[] = [];
  const disabled: { id: string; reason: string }[] = [];
  for (const id of cfg.enabled) {
    const free = FREE_FACTORIES[id];
    if (free) {
      active.push(free(deps, cfg));
      continue;
    }
    const keyed = KEYED[id];
    if (keyed) {
      const cred = keyed.refs.map((r) => creds.get(r)).find((v) => v && v.length > 0);
      if (!cred) {
        disabled.push({ id, reason: `missing credential for ${id} (ref: ${keyed.refs[1]})` });
        continue;
      }
      active.push(keyed.make(cred)(deps, cfg));
      continue;
    }
    disabled.push({ id, reason: `unknown engine id: ${id}` });
  }
  return { active, disabled };
}

export function engineById(id: string, active: Engine[]): Engine | undefined {
  return active.find((e) => e.id === id);
}
