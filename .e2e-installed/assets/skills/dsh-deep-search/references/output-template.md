# 最终答案模板（硬要求）

## 每条关键事实必须带四元组
```
[来源标题](URL) · 日期 · 可信度 A/B/C/D
"引用原文短句"
```

## 情形 A：官方确认（officialConfirmation=found，含 A 级）
> **Qwen4-Max 已于 2026-10-10 开源发布。**
> 官方公告：[Qwen4-Max is out](https://qwen.ai/blog/…) · 2026-10-10 · A
> 模型卡：[huggingface.co/Qwen/Qwen4-Max](https://huggingface.co/Qwen/Qwen4-Max) · A
> 权重 27B/Max 双版本；社区反应见下。

## 情形 B：只有 B/C 级
> **未见正式公告。** 官方互动显示：[@Alibaba_Qwen 10-09 回复"big or small"](…) · B（暗示，非公告）。
> 社区多源报道：reddit r/LocalLLaMA · 2026-10-10 · C（独立域名 2/3）。

## 情形 C：什么都没找到
> **未检索到"X 发布"的正式公告或可靠证据。**
> 已检索：3 轮 / 18 组查询 / bing+ddg+github+huggingface+reddit+x+weibo。
> 现有线索：[1 条 C 级传闻](…) · 孤证，未经交叉验证。
> 注意：这不等于该事件不存在——可能是未公开、渠道封锁或反爬失败（gaps 显示 x 平台 unavailable）。

## 永远不要
- 把 D 级媒体转述写成事实
- 把"未检索到"写成"不存在 / 没有这回事"
- 把 degraded 的 web 替代结果说成"X 上有讨论"（requestedTarget≠actualTarget 时如实说来源）
- 引用带 `satire`/`clickbait`/`content_farm` flag 的孤证
- 只给结论不给链接和等级
