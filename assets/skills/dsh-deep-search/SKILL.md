---
name: dsh-deep-search
description: "Deep-research protocol for anything time-sensitive or contested: model releases / 是否发布开源, news / 传闻真假, prices / versions, official announcements, community sentiment. Use when one web_search is not enough, when a wrong answer costs credibility, or when the user asks 查证/深挖/最新进展. Runs multi-round iteration (plan → search → parse → rewrite → verify) with A/B/C/D source grading and cross-validation. Never conclude from a single round."
---

# dsh-deep-search — 多轮迭代深度检索协议

## 何时用 / 何时不用

用本技能当问题涉及：
- 时效性事实：发布/开源/上线/版本/价格/新闻（"Qwen4 发布了吗"）
- 真伪验证：传闻、爆料、"有人说 X"（rumor / leak / 据传）
- 需要引用来源的回答（用户要链接、证据、日期）
- 一次 web_search 已经给了结果但你不确定它完整或正确

不要用：
- 你自己的知识可靠回答且不随时间变化的问题
- 纯代码/本地文件操作问题

## 四个角色（你 + 三个工具）

- **规划器=你**：把问题拆成 10-20 组候选查询，覆盖：中英文、同义词（发布/开源/上线/权重/模型卡）、官方账号、平台定向、精确短语、时间范围。
- **检索执行器=`deep_search`**：并行执行你的查询数组，跨轮自动去重，返回已分级（A/B/C/D）、已聚类、带 gaps/hint 的结果信封。
- **解析+重写器=你（插件辅助标注）**：每轮从 `extracted`（@账号/日期/版本/引语/动作词）抽新关键词，决定下一轮扩展还是缩小。
- **验证器=`research_state` + `verify_claims` + 你**：交叉验证矩阵给你独立源计数，你对最终结论分级。

## 迭代循环（默认行为，不等用户催）

```
第 1 轮：deep_search({question, queries: [...]})   // 不传 researchId = 新建
读信封：officialConfirmation / clusters / gaps / hint / extracted 里的新实体
判停：officialConfirmation=found 且有 A 级证据 → 可停
否则改写查询（见下）→ deep_search({researchId: <上一轮返回值>, queries: [...]})
…最多 5 轮（maxRoundsReached=true 时必须停下作答）
收尾：research_state({researchId, action:"summary"}) 拿交叉验证矩阵
可选：verify_claims 逐条核对关键断言
```

终止条件（任一满足就停止检索、开始作答）：
1. 找到 A 级官方公告（officialConfirmation.status = "found" 且证据含 A 级）
2. 一轮下来没有新关键词可加（查询计划收敛）
3. 轮次用尽（maxRoundsReached = true）

⚠ 终止条件 2 的陷阱（真实教训 2026-10-15）：用户问题里常藏着**子事件**，第一轮没拆就会漏。例：问"Qwen4 发布时间"，子事件至少包括——①官宣阵容（四款）②"Coming Soon" ③官推"大小都要"暗示 Max+27B 同发 ④架构预览版已开源。第③点第一轮漏查、被用户纠正才查到（news.qq.com 2026-10-13）。**拆法：把问题里的每个实体×每个动作×时间线阶段各列一组查询，不要只查"大问题"**。
⚠ **新实体必查**：每轮 `extracted` 里出现的新实体（新版本号/新账号/新引语，如"大小都要"这种 quotes 字段内容），若与问题相关，下一轮必须为它单独出查询——它是线索不是噪声。
⚠ 某渠道 failed/unavailable 时，先换路径再下结论：X 动态常被新闻站转载，`site:x.com` 走 bing、或"官推+事件词"直接搜网页索引，往往比直连 X 更可达。**禁止**把"渠道失败"直接写成"查不到"。

## 查询规划清单（第 1 轮至少覆盖 5 类）

| 类别 | 例子 |
|---|---|
| 中文原问 | `"Qwen4 发布了吗"` |
| 英文同义 | `"Qwen4 release" / "Qwen4 open weights"` |
| 同义词展开 | 发布/开源/上线/放出权重/模型卡 · release/launch/open-source/weights/model card |
| 官方账号定向 | `{q:"from:Alibaba_Qwen Qwen4", target:"x"}`；`{q:"QwenLM", target:"github"}` |
| **子事件拆解** | 问题含多实体时逐对组合：`"Qwen4 Max 27B 同步发布"` / `"same day" / "together"`；暗示类词：官推/预告/暗示/teaser/hint |
| 平台定向 | 模型发布类 → huggingface + modelscope + github；口碑 → reddit + zhihu + v2ex；突发 → bing + hackernews + weibo + x；教程报错 → stackoverflow |
| 精确短语 | `{q:"\"Qwen4-Max\" released"}` |
| 时间范围 | timeRange: "week" / "month"（问"最近/上周"时收紧） |

## 扩展/缩小规则（重写查询时）

结果太少（newCount < 3）→ 扩展：
- 加同义词、加英文、加别名/简称、去掉引号、放宽 timeRange、换 target 到通用引擎

结果太多太杂（newCount > 25 或 cluster 里混入无关事件）→ 缩小：
- 加引号精确短语、`site:`（如 site:qwen.ai、site:huggingface.co）、`intitle:`、时间收紧、加版本号实体

每轮必看：
- `gaps`：哪个平台失败/降级——X/weibo/bilibili 是尽力而为，失败就改用通用引擎+`site:` 重试，不要当成"没有内容"
- `hint.suggest`：插件的规则建议（参考，不强制）
- `skippedDuplicates` 很高 = 你在搜同样的东西，换角度而不是重复措辞

## 可信度分级（信封已标好，回答时引用）

| 级 | 来源 | 用法 |
|---|---|---|
| A | 官方公告/模型卡/官方仓库 release | 可直接作结论 |
| B | 官方账号互动/回复/暗示 | 高可信但注明"非正式公告" |
| C | 社区爆料/论坛/Reddit/知乎 | 必须交叉验证：cluster 独立域名 ≥2 才可陈述，且注明"社区消息称" |
| D | 媒体解读/聚合站/未知域名 | 只能作线索；带 clickbait/content_farm/satire flags 的默认不采信 |

flags 速查：`single_source`（孤证）、`date_conflict`（同事件日期矛盾——很可能旧闻或误传）、`stale`（旧闻）、`low_trust_only`（没有任何官方/半官方源）、`satire`/`clickbait`/`content_farm`（虚假信号）。

## 输出模板（最终答案硬要求）

每条关键结论附：`[来源标题](链接) · 日期 · 可信度 X 级`，重要事实引用原文短句。

- **找到官方公告（A）**：直接结论 + 来源。
- **只有 B/C**：写"未见正式公告；官方互动显示…/社区多源报道…"并列出各源等级。
- **什么都没找到**：写 **"未检索到正式公告/证据"** + 列出检索覆盖面（查了哪些平台几轮）+ 现有线索及等级 + 明确声明 **"这不等于不存在，可能是未公开/封锁消息/渠道受限"**。

禁止：单轮下结论；把 C/D 级写成事实；把"没搜到"说成"没有"；把 degraded 的 web 替代结果说成 X 平台内容（看 requestedTarget）。

## doctor

配置疑问先 `deep_search({doctor:true})`：零配额列出各引擎/平台就绪状态、缺哪些凭据（全部可选，免费通道默认可用）、谁在冷却。
