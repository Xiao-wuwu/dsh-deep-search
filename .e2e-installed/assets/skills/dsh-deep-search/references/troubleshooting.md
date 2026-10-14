# 故障排查

## 先看 doctor（零配额）
`deep_search({doctor:true})` 列出：
- 各引擎/平台 ready / cooling / disabled 及原因
- 缺哪些可选凭据（**缺凭据不影响默认流程**——免费通道覆盖全部核心平台）
- 谁在冷却（429/风控后自动移链尾，15 分钟自愈）

## gaps 状态怎么读
| status | 含义 | 对策 |
|---|---|---|
| `failed` | 网络/解析错误 | 换 target 重试一轮 |
| `unavailable` | 配额/风控/无 X 访问/研究过期 | 冷却期内改走通用引擎 + `site:x.com` |
| `degraded` | 请求 A 却只拿到 B（如 x→web） | 引用时按 actualTarget 说，别冒充 A 覆盖 |

## 常见现象
- **skippedDuplicates 很高**：措辞在原地打转。换实体词（版本号/人名）、换语言、换 target，别只换同义词。
- **results 全 D**：官方渠道这一轮没覆盖。补 target:"huggingface"/"github" 定向，或 `site:官方博客域`。
- **maxRoundsReached=true 仍无 A**：接受"未检索到"（情形 C 模板），别继续烧轮次。
- **research not found**：researchId 已 TTL（默认 2h）或被 close。省略 id 重新开始，旧结论仍可引用你上下文里已有的结果。
- **知乎/微博/B站 一直 failed**：verify/best-effort 档正常波动（风控）。知乎配 `ZHIHU_ACCESS_SECRET`（DSH 凭据存储）后升稳定档；微博/B站无 key 可用时，用 bing `site:weibo.com` 绕行。

## 成本与礼貌
- 一轮 ≤24 条查询、并发 ≤8；公共端点有本地令牌桶限频。
- 想省钱：`{targets:["github","huggingface"]}` 优先官方 API 通道，HTML 引擎留给兜底。
