/** Plugin configuration: defaults + deep merge. Dependency-free (schemastery schema
 *  is wired only at the plugin entry; core logic must load without DSH services). */

export interface EngineConfigView {
  enabled: string[];
  searxngInstances: string[];
  proxyByTarget: Record<string, string>;
}

export interface PlatformConfigView {
  enabled: string[];
  custom: unknown[];
  xEndpoint: string; // optional third-party/official X search endpoint URL (empty = none)
}

export interface LimitsView {
  concurrency: number;
  perTargetConcurrency: number;
  queryTimeoutMs: number;
  maxQueriesPerCall: number;
  maxRounds: number;
  budgetChars: number;
  rateLimitPerMinute: number;
}

export interface Config {
  engines: EngineConfigView;
  platforms: PlatformConfigView;
  limits: LimitsView;
  cooldown: { enabled: boolean; minutes: number };
  cache: { lruSize: number; ttlMinutes: number; persist: boolean };
  trust: { extraOfficialDomains: string[]; extraOfficialAccounts: string[]; extraFarmPatterns: string[] };
  promptInjection: boolean;
  researchTtlMinutes: number;
}

// keyed engines stay in the enabled list: without a credential they auto-disable
// (with a reason) but remain visible in the doctor report — "optional, never paid-forced"
const DEFAULT_ENGINE_IDS = [
  "bing", "ddg", "ddg-lite", "searxng", "mojeek", "firecrawl-keyless",
  "tavily", "serper", "bocha", "exa",
];
const DEFAULT_PLATFORM_IDS = [
  "github", "hackernews", "reddit", "stackoverflow", "wikipedia",
  "v2ex", "npm", "huggingface", "modelscope", "zhihu",
  "bilibili", "weibo", "x",
];

export function defaultConfig(): Config {
  return {
    engines: { enabled: [...DEFAULT_ENGINE_IDS], searxngInstances: [], proxyByTarget: {} },
    platforms: { enabled: [...DEFAULT_PLATFORM_IDS], custom: [], xEndpoint: "" },
    limits: {
      concurrency: 8, perTargetConcurrency: 2, queryTimeoutMs: 15000,
      maxQueriesPerCall: 24, maxRounds: 5, budgetChars: 9000, rateLimitPerMinute: 30,
    },
    cooldown: { enabled: true, minutes: 15 },
    cache: { lruSize: 500, ttlMinutes: 10, persist: false },
    trust: { extraOfficialDomains: [], extraOfficialAccounts: [], extraFarmPatterns: [] },
    promptInjection: true,
    researchTtlMinutes: 120,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: unknown): T {
  // an explicitly-undefined patch value must NOT erase a default (host may pass
  // config keys as undefined when the profile omits them)
  if (patch === undefined) return base;
  if (!isPlainObject(patch) || !isPlainObject(base)) {
    return (patch === undefined ? base : structuredCloneSafe(patch)) as T;
  }
  const out: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(patch)]);
  for (const k of keys) {
    out[k] = k in patch ? deepMerge((base as Record<string, unknown>)[k], (patch as Record<string, unknown>)[k])
                       : structuredCloneSafe((base as Record<string, unknown>)[k]);
  }
  return out as T;
}

function structuredCloneSafe(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(structuredCloneSafe);
  if (isPlainObject(v)) {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) o[k] = structuredCloneSafe(val);
    return o;
  }
  return v;
}

/** Deep-merge a partial user config onto a fresh copy of the defaults (never mutates). */
export function mergeConfig(user: unknown): Config {
  return deepMerge(defaultConfig(), user);
}
