import assert from "node:assert/strict";
import test from "node:test";

import { defaultConfig, mergeConfig } from "../src/config.ts";
import { resolveCreds, CREDENTIAL_REFS } from "../src/credentials.ts";
import { buildDoctor } from "../src/doctor.ts";
import { buildEngines } from "../src/engines/registry.ts";
import { buildPlatforms } from "../src/platforms/registry.ts";
import { Cooldown } from "../src/http/limits.ts";
import { createHttpClient } from "../src/http/client.ts";

test("defaultConfig carries spec §7 shape", () => {
  const c = defaultConfig();
  assert.ok(c.engines.enabled.includes("bing"));
  assert.ok(c.platforms.enabled.includes("github"));
  assert.equal(c.limits.concurrency, 8);
  assert.equal(c.limits.maxRounds, 5);
  assert.equal(c.limits.budgetChars, 9000);
  assert.equal(c.cooldown.enabled, true);
  assert.equal(c.promptInjection, true);
});

test("mergeConfig: partial user JSON deep-merges, keeps defaults", () => {
  const c = mergeConfig({ limits: { concurrency: 4 } });
  assert.equal(c.limits.concurrency, 4);
  assert.equal(c.limits.maxRounds, 5, "unspecified sibling preserved");
  assert.ok(c.engines.enabled.length > 0);
});

test("mergeConfig: never mutates default object", () => {
  const a = mergeConfig({ limits: { concurrency: 3 } });
  const b = mergeConfig({});
  assert.equal(b.limits.concurrency, 8, "defaults intact after prior merge");
  assert.notEqual(a.engines, b.engines);
});

test("resolveCreds: only present refs yield entries; empty/missing excluded", () => {
  const store = new Map([["TAVILY_API_KEY", "tv"], ["ZHIHU_ACCESS_SECRET", ""], ["SERPER_API_KEY", "sp"]]);
  const creds = resolveCreds(store);
  assert.equal(creds.get("tavily"), "tv");
  assert.equal(creds.get("serper"), "sp");
  assert.equal(creds.get("zhihu"), undefined, "empty secret must NOT become a blank credential");
  assert.equal(CREDENTIAL_REFS.tavily, "TAVILY_API_KEY");
});

test("buildDoctor: reports disabled engines/platforms + cooldowns + missing creds", () => {
  const cfg = mergeConfig({});
  const deps = { http: createHttpClient(), cooldown: new Cooldown() };
  deps.cooldown.mark("bing", 10);
  const engines = buildEngines(cfg.engines, new Map(), deps);
  const platforms = buildPlatforms(cfg.platforms, new Map(), deps);
  const report = buildDoctor(cfg, { engines, platforms, cooldown: deps.cooldown });
  assert.ok(report.engines.some((r) => r.id === "bing" && r.cooling === true));
  assert.ok(report.engines.some((r) => r.id === "tavily" && !r.ready && /credential/i.test(r.reason ?? "")));
  assert.ok(report.platforms.some((r) => r.id === "zhihu" && !r.ready));
  assert.ok(report.missingCredentials.includes("TAVILY_API_KEY"));
  assert.ok(report.fixes.length > 0);
});

test("buildDoctor: ready rows for configured credential + free engine", () => {
  const cfg = mergeConfig({});
  const deps = { http: createHttpClient(), cooldown: new Cooldown() };
  const creds = resolveCreds(new Map([["TAVILY_API_KEY", "k"]]));
  const engines = buildEngines(cfg.engines, creds, deps);
  const platforms = buildPlatforms(cfg.platforms, creds, deps);
  const report = buildDoctor(cfg, { engines, platforms, cooldown: deps.cooldown });
  assert.ok(report.engines.find((r) => r.id === "tavily")?.ready === true);
  assert.ok(report.engines.find((r) => r.id === "bing")?.ready === true);
});
