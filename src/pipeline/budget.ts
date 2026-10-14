/** Output budget: order results by trust → cluster size → recency, then hard-truncate
 *  by item count and/or serialized-char budget (token discipline, spec §3.1). */
import type { SourceResult, TrustRank } from "../types.ts";

const RANK_WEIGHT: Record<TrustRank, number> = { A: 4, B: 3, C: 2, D: 1 };

export interface BudgetResult {
  kept: SourceResult[];
  omittedCount: number;
  reason: "maxItems" | "budgetChars" | "none";
}

export interface BudgetOpts {
  maxItems?: number;
  budgetChars?: number;
  snippetCapChars?: number;
}

function charCost(h: SourceResult, cap: number): number {
  return Math.min(h.snippet.length, cap) + h.title.length + h.url.length + 64; // 64 ≈ envelope overhead
}

export function budgetEnvelope(hits: SourceResult[], opts: BudgetOpts = {}): BudgetResult {
  const cap = opts.snippetCapChars ?? 280;
  const sorted = [...hits].sort((a, b) => {
    const tr = RANK_WEIGHT[b.trustRank] - RANK_WEIGHT[a.trustRank];
    if (tr !== 0) return tr;
    const cs = (b.clusterSize ?? 1) - (a.clusterSize ?? 1);
    if (cs !== 0) return cs;
    return (b.date ?? "").localeCompare(a.date ?? "");
  });

  const kept: SourceResult[] = [];
  let used = 0;
  let reason: BudgetResult["reason"] = "none";
  const maxItems = opts.maxItems ?? Infinity;
  const budget = opts.budgetChars ?? Infinity;

  for (const h of sorted) {
    h.snippet = h.snippet.length > cap ? `${h.snippet.slice(0, cap - 1)}…` : h.snippet;
    if (kept.length >= maxItems) { reason = "maxItems"; break; }
    const cost = charCost(h, cap);
    if (used + cost > budget) { reason = "budgetChars"; break; }
    used += cost;
    kept.push(h);
  }
  return { kept, omittedCount: sorted.length - kept.length, reason };
}
