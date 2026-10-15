import { defineConfig } from "tsdown";

// [2026-10-15 本地补丁] 双入口：host 半（src/index.ts，node 平台）+ client 半
// （src/client.ts，browser 平台，供设置页加载）。两者都 ESM。
// client 半只依赖 @deepseek-ai/*（全部 neverBundle，由宿主提供）与 React（宿主提供），
// 因此产物是纯胶水代码，不含第三方运行时。
//
// sourcemap 关闭（本地瘦身，2026-10-15）：.map 占安装体积 236 KB / 9.4%，
// 生产环境用不到；需要调试时把 sourcemap 改回 true 重新构建即可。
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: "esm",
    target: "node22",
    platform: "node",
    outDir: "lib",
    sourcemap: false,
    // tsc --noEmit does typechecking; tsdown alone owns lib/ (dts: true bundles
    // declarations next to the entry — lib/types/ from a separate tsc pass would
    // just get cleaned by our own cleanOutputs)
    dts: true,
    cleanOutputs: true,
    // runtime deps stay external; @deepseek-ai/* peers must never be bundled
    deps: {
      neverBundle: [/^@deepseek-ai\//],
    },
  },
  {
    entry: { client: "src/client.ts" },
    format: "esm",
    target: "node22",
    platform: "browser",
    outDir: "lib",
    sourcemap: false,
    dts: true,
    // 不清空：host 半的产物要先于本项生成（cleanOutputs 只保留在第一项）
    cleanOutputs: false,
    deps: {
      neverBundle: [/^@deepseek-ai\//, /^react/, /^react-dom/, /^clsx$/],
    },
  },
]);
