/** Trust grading (A/B/C/D) + misinformation flags from catalog/trust.v1.json. Pure. */
import type { SourceResult, TrustRank, TrustSpec } from "../types.ts";

const OFFICIAL_PAGE_PATTERNS = /\/(blog|news|release|model|models|about|research|changelog)\b|^https:\/\/huggingface\.co\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i;
const COMMUNITY_URL_PATTERNS = /(reddit\.com|news\.ycombinator\.com|v2ex\.com|zhihu\.com|weibo\.com|bilibili\.com|x\.com|twitter\.com|juejin\.cn|csdn\.net|linux\.do)/i;
const TRUST_ORDER = ["D", "C", "B", "A"] as const;

function host(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

function matchSuffix(h: string, patterns: string[]): boolean {
  return patterns.some((p) => p.startsWith("*") ? h.endsWith(p.slice(1)) : h === p || h.endsWith(`.${p}`));
}

/** The single source of truth for a result's A/B/C/D rank (flags do NOT downgrade it). */
export function gradeTrust(hit: SourceResult, trust: TrustSpec): TrustRank {
  const h = host(hit.url);
  const author = (hit.author ?? "").replace(/^@/, "").toLowerCase();
  const officialAccounts = trust.officialAccounts.map((a) => a.replace(/^@/, "").toLowerCase());

  // A: official domain; for generic hosts (github/hf) only on official-page shapes
  if (matchSuffix(h, trust.officialDomainPatterns)) {
    const generic = h === "github.com" || h === "huggingface.co" || h === "modelscope.cn";
    if (!generic || OFFICIAL_PAGE_PATTERNS.test(hit.url) || officialAccounts.includes(h.split("/")[0]!.toLowerCase())) {
      return "A";
    }
  }
  // A: platform-targeted official evidence (hf org model card, github org release)
  if ((hit.target === "huggingface" || hit.target === "modelscope" || hit.target === "github") && OFFICIAL_PAGE_PATTERNS.test(hit.url)) return "A";
  // B: author is a known official account (on social/community URLs)
  if (author !== "" && officialAccounts.includes(author) && COMMUNITY_URL_PATTERNS.test(hit.url)) return "B";
  // B: platform-native community with verified-ish author on community host
  if (COMMUNITY_URL_PATTERNS.test(hit.url) && author !== "" && officialAccounts.includes(author)) return "B";
  // C: community hosts, or known C-target platforms
  if (COMMUNITY_URL_PATTERNS.test(hit.url) || ["reddit", "hackernews", "v2ex", "zhihu", "weibo", "bilibili", "x"].includes(hit.target)) return "C";
  // A again for official domain not caught by generic gate
  if (matchSuffix(h, trust.officialDomainPatterns)) return "A";
  return "D";
}

export interface DeriveFlagsCtx {
  expectsOfficial?: boolean;
  /** "latest"-flavoured questions: results older than 180d get `stale`. */
  wantsFresh?: boolean;
  now?: number;
}

const clickbaitZh = (pats: string[]): RegExp => new RegExp(pats.join("|"), "i");
const clickbaitEn = (pats: string[]): RegExp => new RegExp(pats.join("|"), "i");

/** Derive and APPEND flags for every hit (mutates hit.flags). */
export function deriveFlags(hits: SourceResult[], clusters: { clusterId: string; size: number; memberIds: string[] }[], trust: TrustSpec, ctx: DeriveFlagsCtx = {}): void {
  const zh = clickbaitZh(trust.clickbaitPatterns.zh);
  const en = clickbaitEn(trust.clickbaitPatterns.en);
  const byCluster = new Map<string, { size: number }>();
  for (const c of clusters) byCluster.set(c.clusterId, c);

  for (const hit of hits) {
    hit.flags = [];
    const h = host(hit.url);
    const anyMatch = (pats: string[]): boolean => pats.some((p) => h === p.replace(/^\*\./, "") || h.endsWith(p.replace(/^\*\./, "")) || h.includes(p.replace(/^\*\./, "")));

    if (matchSuffix(h, trust.contentFarmPatterns) || anyMatch(trust.contentFarmPatterns)) hit.flags.push("content_farm");
    if (trust.satireDomains.some((s) => h === s || h.includes(s))) hit.flags.push("satire");
    if (zh.test(hit.title) || en.test(hit.title.toUpperCase())) hit.flags.push("clickbait");

    const cluster = hit.clusterId ? byCluster.get(hit.clusterId) : undefined;
    const size = cluster?.size ?? (hit.clusterSize ?? 1);
    if (size <= 1 && (hit.trustRank === "C" || hit.trustRank === "D")) hit.flags.push("single_source");

    // date_conflict: own date is earlier than another cluster member by wildly (>90d)
    if (hit.date && cluster) {
      const peers = (clusters.find((c) => c.clusterId === hit.clusterId)?.memberIds ?? [])
        .map((u) => hits.find((x) => x.url === u)?.date)
        .filter((d): d is string => !!d);
      const t = Date.parse(hit.date);
      for (const p of peers) {
        if (Math.abs(Date.parse(p) - t) > 90 * 86400_000) { hit.flags.push("date_conflict"); break; }
      }
    }

    if (ctx.wantsFresh && hit.date) {
      const ageDays = ((ctx.now ?? Date.now()) - Date.parse(hit.date)) / 86400_000;
      if (ageDays > 180) hit.flags.push("stale");
    }

    if (ctx.expectsOfficial && hit.trustRank === "D") hit.flags.push("low_trust_only");
  }

  // expectsOfficial + NO A/B anywhere in this round → flag every hit low_trust_only (never claim absence)
  if (ctx.expectsOfficial && !hits.some((x) => TRUST_ORDER.indexOf(x.trustRank) >= 2)) {
    for (const hit of hits) if (!hit.flags.includes("low_trust_only")) hit.flags.push("low_trust_only");
  }
}
