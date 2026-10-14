/** Lexical claim↔evidence matching: Latin words + CJK bigrams + entity weighting. Pure. */
import type { SourceResult } from "../types.ts";

const norm = (s: string): string =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const stopwords = new Set(["the", "a", "an", "is", "are", "was", "on", "in", "at", "for", "with", "of", "to", "and", "了", "的", "在", "和", "是", "有"]);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of norm(text).split(" ")) {
    if (w.length >= 2 && !stopwords.has(w)) out.add(w);
  }
  for (const run of text.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  }
  return out;
}

/** Quoted/CJK-run overlap (Jaccard-ish, capped 1). */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

/** Entity extras: versions (Qwen4-Max), ISO dates, @accounts pulled from the raw text. */
function entitySet(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z]+[\w.\-]*\d[\w.\-]*/g)) out.add(m[0].toLowerCase());
  for (const m of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) out.add(m[0]);
  for (const m of text.matchAll(/@([\w]{2,30})/g)) out.add(`@${m[1]!.toLowerCase()}`);
  return out;
}

export interface EvidenceMatch {
  supports: SourceResult[];
  contradicts: SourceResult[];
  independentDomains: number;
  trustMix: Record<string, number>;
}

/** 0..1 evidence score for one claim vs one result: 0.5·entity-overlap + 0.5·token-overlap. */
export function claimScore(claim: string, hit: SourceResult): number {
  const hitText = `${hit.title} ${hit.snippet} ${hit.date ?? ""}`;
  const ent = entitySet(claim);
  const entHit = entitySet(hitText);
  let entScore = 0;
  if (ent.size > 0) {
    let inter = 0;
    for (const e of ent) if (entHit.has(e)) inter++;
    entScore = inter / ent.size;
  } else {
    entScore = 0;
  }
  const tokScore = overlap(tokens(claim), tokens(hitText));
  // entity-weighted: entities 50% when present, tokens carry the rest
  return ent.size > 0 ? 0.5 * entScore + 0.5 * tokScore : tokScore;
}

const THRESHOLD = 0.35;

/** Date-contradiction check: same main entity token(s) but a different explicit ISO date. */
function contradicts(claim: string, hit: SourceResult): boolean {
  const claimDates = [...claim.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((m) => m[0]);
  if (claimDates.length === 0) return false;
  const hitDates = [...`${hit.title} ${hit.snippet} ${hit.date ?? ""}`.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].map((m) => m[0]);
  if (hitDates.length === 0) return false;
  const sharesEntity = entitySet(claim).size > 0 && overlap(entitySet(claim), entitySet(hit.title + " " + hit.snippet)) >= 0.5;
  if (!sharesEntity) return false;
  return hitDates.every((d) => !claimDates.includes(d));
}

/** Split corpus into supports / contradicts for one claim. */
export function findEvidence(claim: string, corpus: SourceResult[]): EvidenceMatch {
  const supports: SourceResult[] = [];
  const contradictsList: SourceResult[] = [];
  for (const hit of corpus) {
    const text = `${hit.title} ${hit.snippet} ${hit.date ?? ""}`;
    const score = claimScore(claim, hit);
    if (contradicts(claim, hit) && score >= 0.2) {
      contradictsList.push(hit);
    } else if (score >= THRESHOLD) {
      supports.push(hit);
    } else if (/\b\d{4}-\d{2}-\d{2}\b/.test(claim) && score >= 0.5 && [...text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)].some((m) => !claim.includes(m[0]!)) && entitySet(claim).size > 0 && overlap(entitySet(claim), entitySet(text)) >= 0.5) {
      contradictsList.push(hit);
    }
  }
  const domains = new Set<string>();
  const trustMix: Record<string, number> = {};
  for (const s of [...supports, ...contradictsList]) {
    try { domains.add(new URL(s.url).hostname.replace(/^www\./, "")); } catch { /* ignore */ }
    trustMix[s.trustRank] = (trustMix[s.trustRank] ?? 0) + 1;
  }
  return { supports, contradicts: contradictsList, independentDomains: domains.size, trustMix };
}
