import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node22",
  platform: "node",
  outDir: "lib",
  sourcemap: true,
  // tsc --noEmit does typechecking; tsdown alone owns lib/ (dts: true bundles
  // declarations next to the entry — lib/types/ from a separate tsc pass would
  // just get cleaned by our own cleanOutputs)
  dts: true,
  cleanOutputs: true,
  // runtime deps stay external; @deepseek-ai/* peers must never be bundled
  deps: {
    neverBundle: [/^@deepseek-ai\//],
  },
});
