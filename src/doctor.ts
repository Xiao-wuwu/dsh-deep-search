/** Doctor (spec §4.6): zero-quota readiness report of engines/platforms/cooldowns/creds.
 *  Consumed by deep_search({doctor:true}) and surfaced verbatim by the SKILL. */
import type { Config } from "./config.ts";
import type { Engine } from "./engines/types.ts";
import type { Platform } from "./platforms/registry.ts";
import type { Cooldown } from "./http/limits.ts";
import { CREDENTIAL_REFS } from "./credentials.ts";

export interface DoctorRow {
  id: string;
  kind: "engine" | "platform";
  tier: string;
  ready: boolean;
  cooling?: boolean;
  reason?: string;
}

export interface DoctorReport {
  engines: DoctorRow[];
  platforms: DoctorRow[];
  cooldowns: { id: string; untilMs: number }[];
  missingCredentials: string[];
  fixes: string[];
}

const TIERS: Record<string, string> = {
  bing: "free", ddg: "free", "ddg-lite": "free", searxng: "free", mojeek: "free", "firecrawl-keyless": "free-quota",
  tavily: "keyed-free-tier", serper: "keyed-free-tier", bocha: "keyed-free-tier", exa: "keyed-free-tier", "firecrawl-key": "keyed-free-tier",
  github: "stable-api", hackernews: "stable-api", reddit: "stable-api", stackoverflow: "stable-api", wikipedia: "stable-api",
  v2ex: "stable-api", npm: "stable-api", huggingface: "stable-api", modelscope: "stable-api", zhihu: "stable-api(official)",
  bilibili: "verify", weibo: "verify", x: "best-effort",
};

export interface DoctorInputs {
  engines: { active: Engine[]; disabled: { id: string; reason: string }[] };
  platforms: { active: Platform[]; disabled: { id: string; reason: string }[] };
  cooldown: Cooldown;
}

export function buildDoctor(cfg: Config, inputs: DoctorInputs): DoctorReport {
  const coolingIds = new Set(inputs.cooldown.list().map((r) => r.id));
  const activeEngine = new Set(inputs.engines.active.map((e) => e.id));
  const activePlatform = new Set(inputs.platforms.active.map((p) => p.id));

  const engines: DoctorRow[] = [];
  for (const id of cfg.engines.enabled) {
    const dis = inputs.engines.disabled.find((d) => d.id === id);
    engines.push({
      id, kind: "engine", tier: TIERS[id] ?? "unknown",
      ready: activeEngine.has(id) && !coolingIds.has(id),
      cooling: coolingIds.has(id),
      ...(dis ? { reason: dis.reason } : {}),
    });
  }

  const platforms: DoctorRow[] = [];
  for (const id of cfg.platforms.enabled) {
    const dis = inputs.platforms.disabled.find((d) => d.id === id);
    platforms.push({
      id, kind: "platform", tier: TIERS[id] ?? "unknown",
      ready: activePlatform.has(id) && !coolingIds.has(id),
      cooling: coolingIds.has(id),
      ...(dis ? { reason: dis.reason } : {}),
    });
  }

  const missingCredentials: string[] = [];
  for (const [channel, ref] of Object.entries(CREDENTIAL_REFS)) {
    if (
      (cfg.engines.enabled.includes(channel) || cfg.platforms.enabled.includes(channel)) &&
      !inputs.engines.active.some((e) => e.id === channel) &&
      !inputs.platforms.active.some((p) => p.id === channel)
    ) {
      missingCredentials.push(ref);
    }
  }

  const fixes: string[] = [];
  for (const m of missingCredentials) {
    fixes.push(`set credential ${m} in the DSH credentials store to enable its channel (optional — free channels cover the default flow)`);
  }
  for (const row of [...engines, ...platforms]) {
    if (row.cooling) fixes.push(`${row.id} is cooling (quota/risk-control) — it stays last in the chain and self-heals`);
    if (!row.ready && !row.cooling && row.tier === "best-effort") {
      fixes.push(`${row.id} is best-effort: failures are reported as gaps, never faked`);
    }
  }

  return { engines, platforms, cooldowns: inputs.cooldown.list(), missingCredentials, fixes };
}
