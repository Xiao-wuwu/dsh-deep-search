/** verify_claims tool logic: match each claim against the research corpus and produce
 *  the evidence table + a RULE-suggested verdict (final adjudication stays with the agent). */
import type { SourceResult } from "../types.ts";
import type { ResearchStore } from "../research/store.ts";
import { findEvidence } from "./lexical.ts";

export type Suggestion = "multi-source" | "single-source" | "conflicting" | "no-evidence";

export interface AdjudicateInput {
  supports: number;
  independentDomains: number;
  hasAB: boolean;
  contradicts: number;
}

/** Deterministic rule synthesis — a SUGGESTION, the model still decides. */
export function adjudicate(inp: AdjudicateInput): Suggestion {
  if (inp.contradicts > 0) return "conflicting";
  if (inp.supports === 0) return "no-evidence";
  if (inp.supports >= 2 && inp.independentDomains >= 2 && inp.hasAB) return "multi-source";
  return "single-source";
}

export interface ClaimResult {
  claimId: string;
  claim: string;
  supports: string[]; // URLs
  contradicts: string[];
  independentSources: number;
  trustMix: Record<string, number>;
  suggestion: Suggestion;
}

export function verifyClaims(
  store: ResearchStore,
  researchId: string,
  claims: { id?: string; text: string }[],
  corpus: SourceResult[],
): ClaimResult[] {
  void store; // researchId validated by the tool layer; kept in signature for future state access
  return claims.map((c, i) => {
    const m = findEvidence(c.text, corpus);
    const hasAB = (m.trustMix["A"] ?? 0) + (m.trustMix["B"] ?? 0) > 0;
    return {
      claimId: c.id ?? `k${i}`,
      claim: c.text,
      supports: m.supports.map((h) => h.url),
      contradicts: m.contradicts.map((h) => h.url),
      independentSources: m.independentDomains,
      trustMix: m.trustMix,
      suggestion: adjudicate({
        supports: m.supports.length,
        independentDomains: m.independentDomains,
        hasAB,
        contradicts: m.contradicts.length,
      }),
    };
  });
}
