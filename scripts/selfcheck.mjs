/** Cold-process self-check: import the BUILT lib/index.mjs (the artifact that ships)
 *  and run apply() against a stub host ctx — proves the packaged module loads and
 *  registers its 3 tools WITHOUT the running Electron process. Run: node scripts/selfcheck.mjs */
import { pathToFileURL } from "node:url";

const url = pathToFileURL(process.argv[2] ?? "lib/index.mjs").href;
const mod = await import(url);
const entry = mod.default ?? mod;
console.log("import OK: name=%s inject=%s", entry.name, JSON.stringify(entry.inject));
if (entry.name !== "dsh-deep-search" || typeof entry.apply !== "function" || !entry.Config) {
  console.error("FAIL: entry shape wrong");
  process.exit(1);
}

const reg = { tools: [], sections: [], creds: 0 };
const stubCtx = {
  logger: () => ({ info: (m) => console.log("   [info]", String(m).slice(0, 160)), warn() {}, error() {} }),
  tools: { register: (def) => { reg.tools.push(def.name); return () => {}; } },
  systemPrompt: { section: (s) => { reg.sections.push(s.name); return () => {}; } },
  effect: () => {},
  inject: (names, cb) => {
    if (names.includes("credentials")) reg.creds++;
    // provide NO credentials/skills services → exercises the degrade path (must not throw)
  },
};
// sparse, host-shaped config (array fields undefined) — the exact live crash trigger
entry.apply(stubCtx, { enabledEngines: undefined, enabledPlatforms: undefined, promptInjection: true });
await new Promise((r) => setTimeout(r, 20));

const want = ["deep_search", "research_state", "verify_claims"];
const ok = JSON.stringify(reg.tools.sort()) === JSON.stringify(want) && reg.sections.length === 1;
console.log("registered tools:", reg.tools.join(","));
console.log("prompt sections:", reg.sections.join(","));
console.log(ok ? "SELFCHECK PASS" : "SELFCHECK FAIL");
process.exit(ok ? 0 : 1);
