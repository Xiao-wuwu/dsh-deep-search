# 查询规划清单（第 1 轮逐项过一遍）

给定用户问题，生成 10-20 组候选查询，按下面的类别各出 1-3 条，宁多勿少：

## 1. 语言变体
- 中文原问 + 英文翻译（模型名/术语保留原文）
- 例："Qwen4 发布了吗" → `Qwen4 release` / `Qwen4 open weights`

## 2. 同义词展开（按话题选）
| 中文 | 英文 |
|---|---|
| 发布 / 上线 / 推出 / 放出 | release / launch / ship / drop |
| 开源 / 开放权重 | open-source / open weights |
| 权重 / 模型卡 | weights / model card / checkpoint |
| 预告 / 泄露 / 传闻 | teaser / leak / rumor |

## 3. 官方账号定向
- X：`from:<官方handle> <关键词>`（target:"x"）
- GitHub：org 名直接搜（target:"github"）
- 微博/知乎：机构名 + 关键词（target:"weibo"/"zhihu"）

## 4. 平台定向（话题 → 平台映射）
| 话题 | 首选平台 |
|---|---|
| 模型发布/权重 | huggingface, modelscope, github, 官方博客(经 bing 加 site:) |
| 口碑/评测 | reddit, zhihu, v2ex, bilibili, hackernews |
| 突发/爆料 | bing, ddg, hackernews, weibo, x |
| 报错/复现 | stackoverflow, github issues, v2ex |

## 5. 精确短语
- `"Qwen4-Max"`（引号）；`intitle:Qwen4`；`site:qwen.ai Qwen4`

## 6. 时间范围
- "本周/昨天/最近" → timeRange: "day"/"week"
- 无时间词也各来一条 timeRange:"month" 的，防旧闻淹没（旧闻会被插件标 `stale`）

## 常见模型厂商官方域（写 site: 时用）
qwen.ai / qwenlm.github.io · deepseek.com · openai.com / openai.blog ·
anthropic.com · ai.meta.com · ai.google.dev / blog.google · mistral.ai ·
moonshot.cn · zhipuai.cn · stepfun.com · minimax.io · x.ai ·
huggingface.co/<org> · github.com/<org> · modelscope.cn/<org>
