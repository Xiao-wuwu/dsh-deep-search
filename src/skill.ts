/** Bundled skill registration — the same optional-inject pattern proven in
 *  dsh-web-search-pro: 'skills' is NOT a static inject (Cordis treats static
 *  inject as required and would hang the fiber); the plugin works without it. */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const SKILL_NAME = "dsh-deep-search";
const PROVIDER_NAME = "dsh-deep-search";
/** Same rank the Host gives packaged skills. */
const BUNDLED_SKILL_RANK = 600;

export const SKILL_DIR = fileURLToPath(new URL("../assets/skills/dsh-deep-search/", import.meta.url));

export interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

export function parseSkillFile(raw: string): ParsedSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) throw new Error("SKILL.md is missing its front matter");
  const field = (key: string): string => {
    const line = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(match[1]!);
    return line ? line[1]!.trim().replace(/^["']|["']$/g, "") : "";
  };
  return { name: field("name"), description: field("description"), body: match[2]!.replace(/^\s+/, "") };
}

export function readSkill(dir: string = SKILL_DIR): ParsedSkill {
  return parseSkillFile(fs.readFileSync(dir + "SKILL.md", "utf8"));
}

/** Minimal host-shape types (declared locally to avoid a build-time dependency). */
interface SkillInvocation { modelInvocable: boolean; userInvocable: boolean }
interface SkillDescriptor {
  name: string; description: string; invocation: SkillInvocation;
  provider: string; source: string; resourceBase: { kind: string; path: string };
  rank: number; locator: string;
}
interface SkillResource extends SkillDescriptor { content: string }
interface SkillProviderLike {
  name: string;
  list(): Promise<SkillDescriptor[]>;
  get(): Promise<SkillResource>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseCtx = any;

export function createSkillProvider(dir: string = SKILL_DIR): SkillProviderLike {
  const resourceBase = { kind: "directory", path: dir };
  const invocation: SkillInvocation = { modelInvocable: true, userInvocable: true };
  readSkill(dir); // fail fast when the packaged file is missing/malformed
  return {
    name: PROVIDER_NAME,
    async list() {
      const skill = readSkill(dir);
      return [{
        name: skill.name, description: skill.description, invocation,
        provider: PROVIDER_NAME, source: "bundled", resourceBase,
        rank: BUNDLED_SKILL_RANK, locator: dir + "SKILL.md",
      }];
    },
    async get() {
      const current = readSkill(dir);
      return {
        name: current.name, description: current.description, invocation,
        provider: PROVIDER_NAME, source: "bundled", resourceBase,
        rank: BUNDLED_SKILL_RANK, locator: dir + "SKILL.md",
        content: current.body,
      };
    },
  };
}

/** Register when the Host exposes a skill registry; track availability for the prompt text. */
export function registerSkillWhenAvailable(ctx: LooseCtx): { isAvailable: () => boolean } {
  let available = false;
  ctx.inject(["skills"], (scope: LooseCtx) => {
    let provider: SkillProviderLike;
    try {
      provider = createSkillProvider();
    } catch (error) {
      ctx.logger(PROVIDER_NAME).warn(`skill not registered: ${String(error)}`);
      return;
    }
    const unregister = scope.skills.registerProvider(() => provider);
    available = true;
    scope.effect(() => () => {
      try { unregister?.(); } catch { /* host may already have dropped it */ }
      available = false;
    });
  });
  return { isAvailable: () => available };
}
