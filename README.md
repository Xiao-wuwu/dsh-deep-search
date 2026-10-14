# dsh-deep-search

> **让你的 DSH 不再一次搜索就下结论。**
> 多轮迭代深度检索 · 14 平台定向 · 来源可信度分级 (A/B/C/D) · 交叉验证 · 虚假信息检测

[![npm version](https://img.shields.io/npm/v/dsh-deep-search)](https://www.npmjs.com/package/dsh-deep-search)
[![license](https://img.shields.io/npm/l/dsh-deep-search)](./LICENSE)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.0--rc.2-brightgreen)](https://github.com/deepseek-ai)

一次 `web_search` 就回答"XX 发布了没有"？模型把聚合站的标题党当成事实、把"没搜到"说成"不存在"？

**dsh-deep-search** 把「查询规划 → 并行检索 → 解析 → 重写 → 验证分级」这套多轮迭代协议变成 DSH 会话的默认行为。智能由你的会话模型驱动，苦力由插件承担——去重、聚类、可信度分级、虚假信号检测全部自动完成。全程零强制付费依赖：不配任何 API Key 也能跑满核心平台，配额耗尽的引擎自动退避到链尾并自愈。

English README: [README.en.md](./README.en.md)

## 快速上手

```bash
dsh plugin --profile desktop add dsh-deep-search
# 重启 DSH（web profile 关闭了 HMR）
```

装好后直接问：「Qwen4-Max 到底发布了吗？」——会话模型会自动加载 deep-research 协议，多轮迭代直到拿到官方 A 级证据或如实报告"未检索到"。

## 核心能力

| | 说明 |
|---|---|
| 🔁 迭代协议默认化 | 系统提示注入 + SKILL：时效/真伪问题自动走多轮（≤5 轮），无需用户催 |
| 🌐 14 平台定向检索 | GitHub · HuggingFace · ModelScope · 知乎 · Reddit · HN · StackOverflow · Wikipedia · V2EX · npm · B站 · 微博 · X(尽力而为) · + 免Key通用引擎(Bing/DDG/SearXNG/Mojeek/Firecrawl) |
| 🧮 可信度分级 A/B/C/D | 官方公告 > 官方互动 > 社区(需交叉验证) > 媒体/未知。数据驱动规则表可扩 |
| 🕵️ 虚假信息信号 | 内容农场 / 标题党 / 讽刺源 / 孤证 / 日期矛盾 / 旧闻 自动打标 |
| 🔗 交叉验证矩阵 | 同事件多源聚类 + 独立域名计数，杜绝"3 家转载当 3 个信源" |
| 🚫 诚实降级 | X/微博/B站 反爬失败 → gaps 明示 `unavailable/degraded`，web 替代绝不冒充 X 覆盖 |
| 📄 "未检索到"纪律 | 找不到时输出：覆盖范围 + 现有线索分级 + "这不等于不存在" |
| 💸 零强制付费 | Keyed 引擎(Tavily/Serper/博查/Exa/Firecrawl-Key)有免费额度，配置了才启用，缺失自动禁用并在 doctor 说明 |

## 三个工具

```jsonc
// 主力：并行检索 + 跨轮去重 + 自动分级
deep_search({
  question: "Qwen4-Max 发布了吗",
  queries: [
    "Qwen4-Max released open weights",
    { q: "\"Qwen4-Max\"", target: "huggingface", timeRange: "week" },
    { q: "from:Alibaba_Qwen Qwen4", target: "x" }
  ],
  researchId: "rs-xxxx" // 续轮，自动只回新增
})
// → { results[trustRank/flags/extracted], clusters, gaps, officialConfirmation, hint, … }

// 交叉验证矩阵 + 轮次历史，写最终答案前先读
research_state({ researchId: "rs-xxxx", action: "summary" })

// 断言 ↔ 已收集证据核对（不再联网），给裁决建议
verify_claims({ researchId: "rs-xxxx", claims: [{ text: "Qwen4-Max 2026-10-10 开源" }] })

// 零配额自检：各引擎/平台就绪、缺哪些可选凭据、谁在冷却
deep_search({ doctor: true })
```

## 架构：四模块，智能在模型、苦力在插件

```
你(规划器) ──生成 10-20 组查询──▶ deep_search(执行器：并行/去重/聚类/分级/预算)
     ▲                                          │
     └──解析+重写：读 extracted 实体 + hint◀────┘
               │ 找到 A 级公告 | 轮次尽 | 无新词
               ▼
        research_state(交叉验证矩阵) ──▶ 你(验证器)生成分级答案
```

## 对比：我该装哪个？

| 插件 | 定位 |
|---|---|
| **dsh-deep-search** | **多轮迭代协议** + 平台定向 + A/B/C/D 分级 + 虚假信息检测；不替代内置 web_search，而是给它装上"查证"的肌肉记忆 |
| dsh-web-search-pro | 重型检索基础设施（缓存/证据包/浏览器渲染），单次检索很强，迭代协议需自配 |
| dsh-free-search | 19 引擎免Key兜底 + 图片墙，广度好，单轮 |
| dsh-zhihu-search | 知乎官方 API 单平台专家 |
| modsearch | 免Key网页/X 桥接（X 需本机 Grok），单次检索 |

它们共存不冲突：本插件自带引擎层，不 override `ctx.web` seam，工具名独立。

## 配置

全部字段可经 DSH 设置页 → 插件 → dsh-deep-search 修改；API Key 一律走 DSH 凭据存储，配置里只存引用名：

```jsonc
{
  "enabledEngines": ["bing", "ddg", "searxng", "mojeek", "firecrawl-keyless", "tavily"],
  "enabledPlatforms": ["github", "huggingface", "modelscope", "reddit", "hackernews", "zhihu", "x"],
  "proxy": "", "proxyByTarget": { "x": "http://127.0.0.1:7890" },
  "concurrency": 8, "maxRounds": 5, "budgetChars": 9000,
  "promptInjection": true
}
```

可选凭据（缺了不影响默认流程）：`TAVILY_API_KEY` · `SERPER_API_KEY` · `BOCHA_API_KEY` · `EXA_API_KEY` · `FIRECRAWL_API_KEY` · `ZHIHU_ACCESS_SECRET`（知乎升稳定档）· `ROLLI_API_TOKEN`（X 升稳定档）。

## 开发

```bash
pnpm install
pnpm run typecheck && pnpm test   # 98 项测试，无需网络
pnpm run build                    # tsc 类型检查 + tsdown 打包 lib/
```

## 许可

MIT

---

## ⭐ 如果觉得有用

这个项目从设计到测试都是一次次「被一次搜索坑了」的真实痛点堆出来的。如果它让你的 DSH 回答变得敢引用、可溯源：

**给个 Star 就是最大的支持** —— 它让更多人（和未来的你）能找到它。发现问题或想要更多平台适配，欢迎开 Issue / PR。
