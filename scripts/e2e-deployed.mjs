/** Cold-process E2E against the INSTALLED artifact: apply() the shipped lib, run the
 *  real tool surface over live network, and validate every envelope with the HOST's own
 *  validator. Proves what runs after the next process start. */
import { pathToFileURL } from "node:url";
import { valueSchemaSpecToJsonSchema, validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";

const INSTALLED = process.argv[2];
const mod = await import(pathToFileURL(INSTALLED).href);
const entry = mod.default ?? mod;

const tools = new Map();
const ctx = {
  logger: () => ({ info() {}, warn() {}, error() {} }),
  tools: { register: (def) => { tools.set(def.name, def); return () => {}; } },
  systemPrompt: { section: () => () => {} },
  effect: () => {},
  inject: () => {},
};
entry.apply(ctx, {});
const exec = { signal: new AbortController().signal, deferContext() {} };

// defineTool() already compiles our declared spec into the raw JSON Schema the host
// validates against — reuse that exact object (no re-compile).
const compiled = new Map();
for (const [name, def] of tools) compiled.set(name, def.output.schema);
const check = (name, value) => validateJsonSchemaValue(compiled.get(name), value);

const question = "Qwen4-Max 是否已经发布并开源权重";
const env = await tools.get("deep_search").execute({
  question,
  queries: [
    "Qwen4-Max released open weights",
    "Qwen4 发布 开源 权重",
    { q: "Qwen4-Max", target: "modelscope", maxResults: 5 },
    { q: "Qwen4-Max", target: "huggingface", maxResults: 5 },
    { q: "QwenLM", target: "github", maxResults: 5 },
    { q: "Qwen4 release announcement", target: "bing" },
    { q: "Qwen4", target: "x" },
  ],
  budgetChars: 7000,
}, exec);

const v1 = check("deep_search", env);
console.log("round1: results=%d clusters=%d gaps=%d official=%s",
  env.results.length, env.clusters.length, env.gaps.length, env.officialConfirmation.status);
console.log("  HOST-validator violations:", v1.length === 0 ? "NONE" : JSON.stringify(v1.slice(0, 4)));
for (const [id, s] of Object.entries(env.stats.perTarget)) {
  console.log(`  ${id.padEnd(12)} hits=${s.hits}${s.error ? " (gap)" : ""}`);
}
console.log("  grades:", env.results.slice(0, 8).map((r) => `${r.trustRank}/${r.target}`).join(" "));

const env2 = await tools.get("deep_search").execute(
  { researchId: env.researchId, queries: [{ q: "Qwen4-Max", target: "modelscope", maxResults: 5 }] }, exec);
console.log("round2: new=%d dupes=%d violations=%s", env2.newCount, env2.skippedDuplicates,
  check("deep_search", env2).length === 0 ? "NONE" : "FAIL");

const st = tools.get("research_state").execute({ researchId: env.researchId, action: "summary" }, exec);
console.log("research_state: rounds=%d matrix=%d trustMix=%s violations=%s", st.roundCount, st.clusters.length,
  JSON.stringify(st.trustMix), check("research_state", st).length === 0 ? "NONE" : "FAIL");

const vc = tools.get("verify_claims").execute({
  researchId: env.researchId,
  claims: [{ text: "Qwen4-Max 已发布开源权重" }, { text: "GPT-6 下周上线" }],
}, exec);
console.log("verify_claims: ok=%s suggestions=%s violations=%s", vc.ok,
  vc.results.map((r) => r.suggestion).join(","), check("verify_claims", vc).length === 0 ? "NONE" : "FAIL");

tools.get("research_state").execute({ researchId: env.researchId, action: "close" }, exec);
const pass = v1.length === 0 && check("deep_search", env2).length === 0 && check("research_state", st).length === 0
  && check("verify_claims", vc).length === 0 && vc.ok && st.ok;
console.log(pass ? "DEPLOYED-ARTIFACT E2E PASS" : "DEPLOYED-ARTIFACT E2E FAIL");
process.exit(pass ? 0 : 1);
