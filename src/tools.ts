/** Model-facing tool shells: registerTools() wraps the pure core (src/tools/core.ts) in
 *  dsh-tools defineTool and registers them. Business logic lives in core (tested w/o DSH). */
import { defineTool, type ToolDefinition } from "@deepseek-ai/dsh-tools";

import {
  runDeepSearch, runResearchState, runVerifyTool,
  type ToolCtx, type DeepSearchArgs, type ResearchStateArgs, type VerifyArgs,
} from "./tools/core.ts";
import {
  deepSearchParams, deepSearchOutput,
  researchStateParams, researchStateOutput,
  verifyParams, verifyOutput,
} from "./tools/schemas.ts";

const asJson = (v: unknown) => [{ type: "text" as const, text: JSON.stringify(v) }];

export function makeDeepSearchTool(ctx: ToolCtx): ToolDefinition {
  return defineTool({
    name: "deep_search",
    description:
      "Multi-round iterative search (the deep-research retriever). Run several targeted queries in parallel; each may name a platform/engine target. Results come pre-deduped across rounds, clustered (same story from many sources merged), trust-graded A/B/C/D, with misinformation flags, an official-announcement verdict, gaps (failed/degraded channels, never faked), and a hint for your next round. Pass the same researchId each round to iterate; omit it to start. Use this for anything time-sensitive, 'has X shipped', rumor verification, or when one web_search is not enough.",
    parameters: deepSearchParams,
    output: { schema: deepSearchOutput, render: (_a, value) => asJson(value) },
    timeoutMs: 60_000,
    isConcurrencySafe: () => true,
    presentCall: (args) => {
      const a = args as unknown as DeepSearchArgs;
      const first = Array.isArray(a.queries) ? (a.queries as unknown[])[0] : undefined;
      const label = typeof first === "string" ? first : (first as { q?: string } | undefined)?.q ?? "deep_search";
      return { card: "generic" as const, kind: "search" as const, title: label, rawInput: label };
    },
    async execute(args, exec) {
      return runDeepSearch({ ...(args as unknown as DeepSearchArgs), signal: exec.signal }, ctx) as never;
    },
  });
}

export function makeResearchStateTool(ctx: ToolCtx): ToolDefinition {
  return defineTool({
    name: "research_state",
    description:
      "Inspect / close an iterative research run. action=summary returns round history, target coverage, A/B/C/D trust mix, and the cross-validation matrix (clusters with independent-domain counts) — read it before writing your final answer. action=reset clears rounds+seen to re-search fresh. action=close releases the run. researchId comes from deep_search.",
    parameters: researchStateParams,
    output: { schema: researchStateOutput, render: (_a, value) => asJson(value) },
    timeoutMs: 10_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      return runResearchState(args as unknown as ResearchStateArgs, ctx) as never;
    },
  });
}

export function makeVerifyClaimsTool(ctx: ToolCtx): ToolDefinition {
  return defineTool({
    name: "verify_claims",
    description:
      "Match specific claims against the evidence already gathered in a research run (no new network). Returns, per claim, supporting vs contradicting sources, independent-source count, trust mix, and a rule-suggested verdict (multi-source/single-source/conflicting/no-evidence). You still make the final call — use this to cross-check before stating anything as fact.",
    parameters: verifyParams,
    output: { schema: verifyOutput, render: (_a, value) => asJson(value) },
    timeoutMs: 15_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      return runVerifyTool(args as unknown as VerifyArgs, ctx) as never;
    },
  });
}

export const TOOL_NAMES = ["deep_search", "research_state", "verify_claims"] as const;

export function buildToolDefinitions(ctx: ToolCtx): ToolDefinition[] {
  return [makeDeepSearchTool(ctx), makeResearchStateTool(ctx), makeVerifyClaimsTool(ctx)];
}
