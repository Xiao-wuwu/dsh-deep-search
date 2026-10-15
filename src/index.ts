/** dsh-deep-search — plugin entry.
 *
 *  Architecture note (plan deviation): apply() lives here rather than a separate
 *  apply.ts — one 150-line composition root is easier to audit than two files.
 *
 *  Optional-service pattern (proven in dsh-web-search-pro / dsh-zhihu-search):
 *  Cordis 4.0.4 treats every STATIC `inject` entry as required, so only `tools`
 *  and `systemPrompt` are static (the plugin's core surface), while `credentials`,
 *  `skills` and `settings` ride scoped `ctx.inject([...])` callbacks and their
 *  absence degrades gracefully instead of hanging the fiber. */
import z from "@deepseek-ai/schemastery";
/** [2026-10-15 本地补丁] 显式导出 Schema 类型：pnpm 布局下 `@deepseek-ai/cosmokit`
 *  存在多份副本，`ConfigSchema` 的推断类型会引用 .pnpm 内部路径而报 TS2742
 *  （"cannot be named without a reference to ..."）。显式标注消除该推断即可。 */
import type Schema from "@deepseek-ai/schemastery";

/** Credential-reference helpers implemented LOCALLY (not imported from
 *  @deepseek-ai/dsh-credentials): that package is only guaranteed as a cordis
 *  SERVICE (ctx.inject(['credentials'])), not a resolvable static import at
 *  plugin load. A top-level import of it crashed activation ("failed to import")
 *  because the specifier is absent from the host load path. The service's
 *  resolve() still accepts the reference-name string; an unbranded ref simply
 *  yields no value and we fall back to process.env — never fatal. */
const CREDENTIAL_REF_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isCredentialRefName = (s: string): boolean => CREDENTIAL_REF_RE.test(s);

import { defaultConfig, mergeConfig, type Config } from "./config.ts";
import { resolveCreds, CREDENTIAL_REFS } from "./credentials.ts";
import { createHttpClient } from "./http/client.ts";
import { CacheStore } from "./http/cache.ts";
import { Cooldown, RateBucket } from "./http/limits.ts";
import { buildEngines } from "./engines/registry.ts";
import { buildPlatforms } from "./platforms/registry.ts";
import { ResearchStore } from "./research/store.ts";
import { buildToolDefinitions } from "./tools.ts";
import type { ToolCtx } from "./tools/core.ts";
import { registerSkillWhenAvailable } from "./skill.ts";
import { buildPromptText } from "./prompt.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const name = "dsh-deep-search";
export const inject = ["tools", "systemPrompt"] as const;

export const ConfigSchema: Schema<Record<string, unknown>> = z.object({
  enabledEngines: z.array(z.string()).default(defaultConfig().engines.enabled).volatile(),
  enabledPlatforms: z.array(z.string()).default(defaultConfig().platforms.enabled).volatile(),
  searxngInstances: z.array(z.string()).default([]).volatile(),
  proxy: z.string().default("").volatile(),
  proxyByTarget: z.dict(z.string()).default({}).volatile(),
  concurrency: z.number().default(8).volatile(),
  queryTimeoutMs: z.number().default(15000).volatile(),
  maxRounds: z.number().default(5).volatile(),
  budgetChars: z.number().default(6000).volatile(),
  rateLimitPerMinute: z.number().default(30).volatile(),
  cooldownMinutes: z.number().default(15).volatile(),
  cacheTtlMinutes: z.number().default(10).volatile(),
  lruSize: z.number().default(500).volatile(),
  xEndpoint: z.string().default("").volatile(),
  xEndpointCredentialRef: z.string().role("credential-ref").default("ROLLI_API_TOKEN").volatile(),
  zhihuCredentialRef: z.string().role("credential-ref").default("ZHIHU_ACCESS_SECRET").volatile(),
  promptInjection: z.boolean().default(true).volatile(),
  /** [2026-10-15 本地补丁] 搜索默认启用：true 时**任何需要联网搜索的问题**都走 deep_search
   *  （不再限于"时效/争议事实"）。`.volatile()` 是设置页能写该字段的前提。 */
  alwaysSearch: z.boolean().default(true).volatile(),
  verbose: z.boolean().default(false).volatile(),
});

const trustSpec = JSON.parse(
  readFileSync(fileURLToPath(new URL("../catalog/trust.v1.json", import.meta.url)), "utf8"),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseCtx = any;

/** apply()'s config shape — mirrors ConfigSchema (schemastery types stay host-side). */
interface PluginConfig {
  enabledEngines: string[];
  enabledPlatforms: string[];
  searxngInstances: string[];
  proxy: string;
  proxyByTarget: Record<string, string>;
  concurrency: number;
  queryTimeoutMs: number;
  maxRounds: number;
  budgetChars: number;
  rateLimitPerMinute: number;
  cooldownMinutes: number;
  cacheTtlMinutes: number;
  lruSize: number;
  xEndpoint: string;
  xEndpointCredentialRef: string;
  zhihuCredentialRef: string;
  promptInjection: boolean;
  /** [2026-10-15 本地补丁] 搜索默认启用开关（见 ConfigSchema.alwaysSearch）。 */
  alwaysSearch: boolean;
  verbose: boolean;
}

export function apply(ctx: LooseCtx, rawConfig: PluginConfig): void {
  const log = ctx.logger(name);

  // 1. live config — host may pass undefined for omitted keys (crash found via
  // dshead headless: "cfg.enabled is not iterable"), so normalize field by field.
  const def = defaultConfig();
  const config: PluginConfig = {
    enabledEngines: Array.isArray(rawConfig?.enabledEngines) ? rawConfig.enabledEngines : def.engines.enabled,
    enabledPlatforms: Array.isArray(rawConfig?.enabledPlatforms) ? rawConfig.enabledPlatforms : def.platforms.enabled,
    searxngInstances: Array.isArray(rawConfig?.searxngInstances) ? rawConfig.searxngInstances : [],
    proxy: typeof rawConfig?.proxy === "string" ? rawConfig.proxy : "",
    proxyByTarget: rawConfig?.proxyByTarget && typeof rawConfig.proxyByTarget === "object" ? rawConfig.proxyByTarget : {},
    concurrency: Number.isFinite(rawConfig?.concurrency) ? rawConfig.concurrency : 8,
    queryTimeoutMs: Number.isFinite(rawConfig?.queryTimeoutMs) ? rawConfig.queryTimeoutMs : 15000,
    maxRounds: Number.isFinite(rawConfig?.maxRounds) ? rawConfig.maxRounds : 5,
    budgetChars: Number.isFinite(rawConfig?.budgetChars) ? rawConfig.budgetChars : 9000,
    rateLimitPerMinute: Number.isFinite(rawConfig?.rateLimitPerMinute) ? rawConfig.rateLimitPerMinute : 30,
    cooldownMinutes: Number.isFinite(rawConfig?.cooldownMinutes) ? rawConfig.cooldownMinutes : 15,
    cacheTtlMinutes: Number.isFinite(rawConfig?.cacheTtlMinutes) ? rawConfig.cacheTtlMinutes : 10,
    lruSize: Number.isFinite(rawConfig?.lruSize) ? rawConfig.lruSize : 500,
    xEndpoint: typeof rawConfig?.xEndpoint === "string" ? rawConfig.xEndpoint : "",
    xEndpointCredentialRef: typeof rawConfig?.xEndpointCredentialRef === "string" && rawConfig.xEndpointCredentialRef ? rawConfig.xEndpointCredentialRef : "ROLLI_API_TOKEN",
    zhihuCredentialRef: typeof rawConfig?.zhihuCredentialRef === "string" && rawConfig.zhihuCredentialRef ? rawConfig.zhihuCredentialRef : "ZHIHU_ACCESS_SECRET",
    promptInjection: typeof rawConfig?.promptInjection === "boolean" ? rawConfig.promptInjection : true,
    alwaysSearch: typeof rawConfig?.alwaysSearch === "boolean" ? rawConfig.alwaysSearch : true,
    verbose: typeof rawConfig?.verbose === "boolean" ? rawConfig.verbose : false,
  };

  const cfg: Config = mergeConfig({
    engines: {
      enabled: config.enabledEngines,
      searxngInstances: config.searxngInstances,
      proxyByTarget: { ...config.proxyByTarget, ...(config.proxy ? {} : {}) },
    },
    platforms: { enabled: config.enabledPlatforms, custom: [], xEndpoint: config.xEndpoint },
    limits: {
      concurrency: config.concurrency, perTargetConcurrency: 2, queryTimeoutMs: config.queryTimeoutMs,
      maxQueriesPerCall: 24, maxRounds: config.maxRounds, budgetChars: config.budgetChars,
      rateLimitPerMinute: config.rateLimitPerMinute,
    },
    cooldown: { enabled: true, minutes: config.cooldownMinutes },
    cache: { lruSize: config.lruSize, ttlMinutes: config.cacheTtlMinutes, persist: false },
    trust: defaultConfig().trust,
    promptInjection: config.promptInjection,
    alwaysSearch: config.alwaysSearch,
    researchTtlMinutes: 120,
  });

  // 2. shared services
  const http = createHttpClient({
    timeoutMs: cfg.limits.queryTimeoutMs,
    proxyByTarget: cfg.engines.proxyByTarget,
    ...(config.proxy ? { defaultProxy: config.proxy } : {}),
  });
  const cooldown = new Cooldown();
  const cache = new CacheStore({ lruSize: cfg.cache.lruSize, ttlMs: cfg.cache.ttlMinutes * 60_000 });
  const bucket = new RateBucket({ perMinute: cfg.limits.rateLimitPerMinute });
  const store = new ResearchStore({ ttlMs: cfg.researchTtlMinutes * 60_000, maxConcurrent: 20 });

  // 3. credential resolution: process.env first (sync), DSH credentials store second
  const refNames = (): Record<string, string> => ({
    ...CREDENTIAL_REFS,
    ...(config.zhihuCredentialRef ? { zhihu: config.zhihuCredentialRef } : {}),
    ...(config.xEndpointCredentialRef ? { x: config.xEndpointCredentialRef } : {}),
  });
  const credMap = new Map<string, string>();
  for (const ref of Object.values(refNames())) {
    const envVal = process.env[ref];
    if (envVal && envVal.trim() !== "") credMap.set(ref, envVal.trim());
  }

  // 4. build channels; rebuildable once credentials land
  const toolCtx: ToolCtx = {
    cfg, store, cooldown,
    cache, trustSpec,
    engines: [], platforms: [],
    disabled: { engines: [], platforms: [] },
    maxConcurrentResearch: 20,
    researchTtlMs: cfg.researchTtlMinutes * 60_000,
  };
  function rebuildChannels(): void {
    const creds = resolveCreds(credMap);
    const deps = { http, cooldown, cache, bucket };
    const engines = buildEngines(
      { ...cfg.engines },
      creds,
      deps,
    );
    const platforms = buildPlatforms(
      { ...cfg.platforms },
      creds,
      { ...deps },
    );
    toolCtx.engines = engines.active;
    toolCtx.platforms = platforms.active;
    toolCtx.disabled = { engines: engines.disabled, platforms: platforms.disabled };
  }
  rebuildChannels();

  if (config.verbose) {
    log.info(`loaded: engines=[${toolCtx.engines.map((e) => e.id).join(",")}] platforms=[${toolCtx.platforms.map((p) => p.id).join(",")}] disabled=${toolCtx.disabled.engines.length + toolCtx.disabled.platforms.length}`);
  }

  // 5. credentials (OPTIONAL service — scoped inject; absence = env-only)
  ctx.inject(["credentials"], (ready: LooseCtx) => {
    const face = ready.credentials;
    let closed = false;
    void (async () => {
      for (const ref of Object.values(refNames())) {
        if (!isCredentialRefName(ref)) continue;
        if (credMap.has(ref)) continue; // env already provided it
        try {
          const resolved = await face.resolve(ref);
          const value = resolved?.value;
          if (!closed && typeof value === "string" && value.trim() !== "") {
            credMap.set(ref, value.trim());
          }
        } catch { /* one missing/unbrandable credential never disables the rest */ }
      }
      if (!closed) rebuildChannels();
    })();
    return () => { closed = true; };
  });

  // 6. tools
  const disposers = buildToolDefinitions(toolCtx).map((def) => ctx.tools.register(def));
  ctx.effect(() => () => {
    for (const dispose of disposers) { try { dispose?.(); } catch { /* unload path never throws */ } }
  }, "dsh-deep-search: tools");

  // 7. skill (OPTIONAL service)
  const skill = registerSkillWhenAvailable(ctx);

  // 8. system prompt (static inject — always present; content gated by config)
  if (cfg.promptInjection) {
    const section = ctx.systemPrompt.section({
      name: "tool:dsh-deep-search",
      order: 112,
      text: () => buildPromptText(skill.isAvailable(), cfg.alwaysSearch),
    });
    ctx.effect(() => () => {
      try { typeof section === "function" ? section() : section?.dispose?.(); } catch { /* host already dropped */ }
    }, "dsh-deep-search: prompt section");
  }
}

export default { name, inject, Config: ConfigSchema, apply };
