/** Envelope-level rules: official-announcement detection (module-4 A/B gate) and the
 *  rewrite "hint" (coverage + expand/shrink suggestions) that steers the agent's next round. */
import type { SourceResult } from "../types.ts";

export interface OfficialConfirmation {
  status: "found" | "none";
  evidence: string[]; // URLs of A/B-grade official matches
}

const OFFICIAL_TARGETS = new Set(["huggingface", "modelscope", "github"]);
const ANNOUNCE_WORDS = ["开源", "发布", "上线", "推出", "同步发布", "released", "launch", "open-source", "announced", "weights"];

function entityTerms(question: string): string[] {
  // crude keyword entities: capitalized-ish tokens, version tokens, and CJK runs ≥2
  const toks = new Set<string>();
  for (const m of question.matchAll(/[A-Za-z][\w.\-]+\d[\w.\-]*|[\u4e00-\u9fff]{2,}/g)) {
    const t = m[0].toLowerCase();
    if (t.length >= 2) toks.add(t);
  }
  return [...toks];
}

/** True when at least one A/B result looks like an official announcement of the asked entity. */
export function officialConfirmation(hits: SourceResult[], question: string): OfficialConfirmation {
  const terms = entityTerms(question);
  const evidence: string[] = [];
  for (const h of hits) {
    if (h.trustRank !== "A" && h.trustRank !== "B") continue;
    const text = `${h.title} ${h.snippet} ${(h.extracted?.actionWords ?? []).join(" ")}`.toLowerCase();
    const hasAnnounce = ANNOUNCE_WORDS.some((w) => text.includes(w.toLowerCase()));
    const matchesEntity = terms.length === 0 || terms.some((t) => text.includes(t));
    const officialish = OFFICIAL_TARGETS.has(h.target) || h.trustRank === "A";
    if (hasAnnounce && matchesEntity && officialish) evidence.push(h.url);
  }
  return { status: evidence.length > 0 ? "found" : "none", evidence };
}

export interface Hint {
  coverage: string;
  suggest: string[];
}

/** Rule-based next-round advice. The agent still makes the final call. */
export function buildHint(input: { ok: string[]; failed: { id: string; reason?: string }[]; newCount: number; total?: number }): Hint {
  const parts: string[] = [];
  if (input.ok.length) parts.push(`已覆盖: ${input.ok.join(", ")}`);
  if (input.failed.length) parts.push(`失败/降级: ${input.failed.map((f) => `${f.id}${f.reason ? `(${f.reason.slice(0, 40)})` : ""}`).join(", ")}`);
  const coverage = parts.join(" | ") || "无覆盖";

  const suggest: string[] = [];
  const failedIds = new Set(input.failed.map((f) => f.id));
  if (failedIds.has("x") || failedIds.has("weibo") || failedIds.has("bilibili")) {
    suggest.push("社交平台走的是尽力而为通道，换通用引擎加 site: 限定重试（如 site:x.com / site:weibo.com）");
  }
  if (input.newCount < 3) {
    suggest.push("结果偏少（扩展）：加同义词/英文/别名、去精确短语、放宽 timeRange、换 engine");
  } else if (input.newCount > 25) {
    suggest.push("结果偏多（缩小）：加引号精确短语、site:、intitle:、from:、收紧 timeRange");
  }
  if (!input.ok.some((id) => OFFICIAL_TARGETS.has(id))) {
    suggest.push("未打到官方证据源：补一轮 huggingface/modelscope/github 定向查询");
  }
  return { coverage, suggest };
}
