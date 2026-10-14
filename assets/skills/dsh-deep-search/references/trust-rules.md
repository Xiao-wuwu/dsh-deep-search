# 信任规则说明（catalog/trust.v1.json）

分级在插件内由 `src/pipeline/trust.ts` 完成，规则表在 `catalog/trust.v1.json`，
用户可在配置 `trust.extraOfficialDomains / extraOfficialAccounts / extraFarmPatterns` 追加。

## 等级
- **A**：官方域名（qwen.ai、deepseek.com、openai.com…；.gov/.edu；HF/ModelScope/GitHub 的 org 模型卡与 release）
- **B**：已知官方账号在社区站上的发言（author ∈ officialAccounts 且 host ∈ 社区）
- **C**：社区（reddit/hn/v2ex/zhihu/weibo/bilibili/个人博客）
- **D**：其余一切（媒体/聚合/未知域名）

顺序判断：A 域名 → A 平台原生证据（org 模型卡/release）→ B 官方账号 → C 社区 → D 兜底。
**flags 不改变等级**，只附加警示。

## 虚假信号 flags
| flag | 触发 | 你该怎么处理 |
|---|---|---|
| `clickbait` | 标题命中中英文标题党正则 | 降级看待，去原文验证 |
| `content_farm` | 域名在农场表 | 不当事实引用 |
| `satire` | 洋葱类讽刺站 | 直接当玩笑 |
| `single_source` | cluster=1 且 C/D | 孤证，下一轮专门找第二来源或明示孤证 |
| `date_conflict` | 同 cluster 日期跨度 >90 天 | 大概率旧闻新炒，核对最早日期 |
| `stale` | 问题含"最新"类词且结果 >180 天 | 旧闻线索，别当现状 |
| `low_trust_only` | 问题期待官方公告但本轮无 A/B | 停笔前必须补一轮定向到官方源，或在答案里明示"无官方确认" |

## 独立源计数（交叉验证）
`research_state(summary)` 的矩阵按 **域名** 去重计数：
同一事件 3 条转载但都来自聚合站 ≠ 3 个独立源。
只有独立域名 ≥2 且含 A/B 级，才按"多源一致"陈述；否则"单一信源，未经交叉验证"。

## 扩展表
想给某公司/某人加白：配置里追加 `extraOfficialDomains`/`extraOfficialAccounts` 即可，
重启后生效，无需改代码。
