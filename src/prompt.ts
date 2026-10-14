/** System-prompt injection text (spec §6.1): the default-behavior nudge. ≤12 lines. */
export function buildPromptText(skillAvailable: boolean): string {
  const skillLine = skillAvailable
    ? "Load skill `dsh-deep-search` for the full protocol before starting."
    : "Plan 10-20 queries first: Chinese+English, synonyms (发布/开源/上线/权重/模型卡 · release/launch/open-source/weights/model-card), official accounts, platform-targeted (huggingface/modelscope/github/reddit/hackernews/zhihu/v2ex/weibo/x/bilibili), exact phrases, time ranges.";
  return [
    "# dsh-deep-search",
    "For time-sensitive or contested facts (是否发布/开源、传闻、最新消息、价格/版本、查证, verify/rumor):",
    "1) Never conclude from a single web_search. Use `deep_search` with a planned query array.",
    "2) Keep the returned `researchId` and iterate (≤5 rounds): each round read `extracted` entities + `hint.suggest`, then rewrite — EXPAND when thin (synonyms/English/broader time), SHRINK when noisy (quotes/`site:`/`intitle:`/tighter time).",
    "3) Stop when `officialConfirmation.status=found` with A-grade evidence, when no new keywords remain, or when `maxRoundsReached`.",
    "4) `gaps` are part of the answer: x/weibo/bilibili are best-effort — a degraded/unavailable gap means the channel failed, NOT that the platform is empty; retry via general engines with site:. Never present web-sourced results as X/Weibo coverage (check requestedTarget).",
    "5) Before answering, read `research_state(summary)` (cross-validation matrix). Cite each key claim as [source](url) · date · trust grade A/B/C/D; use `verify_claims` for anything contested.",
    "6) If nothing confirms, say \"未检索到正式公告/证据\" + what was checked. NEVER say 不存在/没有发生.",
    skillLine,
  ].join("\n");
}
