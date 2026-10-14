/**
 * dsh-deep-search — shared type vocabulary.
 *
 * These are the shapes every layer (engines, platforms, pipeline, tools) is
 * allowed to speak in. Keep this module dependency-free: it is imported by
 * both the Node host code and the contract tests.
 *
 * Honesty discipline (learned from dsh-zhi-search v1.4.0):
 * optional metadata fields are OMITTED when upstream did not provide them —
 * never defaulted to 0 / "" — so the model never reads an invented signal.
 */

export const TRUST_RANKS = ["A", "B", "C", "D"] as const;

export type TrustRank = (typeof TRUST_RANKS)[number];

/** Case-sensitive guard: only the four exact uppercase ranks pass. */
export function isTrustRank(value: unknown): value is TrustRank {
  return typeof value === "string" && (TRUST_RANKS as readonly string[]).includes(value);
}

/**
 * Upper-case + trim an arbitrary rank token; anything unknown degrades to
 * "D" (the least-trusted tier) rather than being silently promoted.
 */
export function normalizeTrust(raw: unknown): TrustRank {
  if (typeof raw !== "string") return "D";
  const candidate = raw.trim().toUpperCase();
  return isTrustRank(candidate) ? candidate : "D";
}

/** Rule-derived signal id (content_farm / clickbait / satire / single_source / date_conflict / stale / low_trust_only …). */
export type Flag = string;

/** Rule-extracted signals found in a result's title/snippet (module-3 assist). */
export interface Extracted {
  accounts: string[];
  dates: string[];
  versions: string[];
  quotes: string[];
  actionWords: string[];
}

/** A projected search result after trust grading + flagging. */
export interface SourceResult {
  title: string;
  url: string;
  snippet: string;
  /** ISO date (YYYY-MM-DD) when upstream exposed one — otherwise the key is absent. */
  date?: string;
  /** Author / account display name when known — otherwise absent. */
  author?: string;
  /** Engine or platform id that produced this hit (bing / github / x …). */
  target: string;
  trustRank: TrustRank;
  flags: Flag[];
  /** Assigned by the clustering stage; absent until then. */
  clusterId?: string;
  /** Cluster membership size; absent until clustering. */
  clusterSize?: number;
  /** Upstream engagement signal (votes/comments); omitted, never zero-filled. */
  votes?: number;
  comments?: number;
  /** Rule-extracted signals; absent until the extract stage. */
  extracted?: Extracted;
}

/** A retrieval channel that failed / was degraded / was unavailable. Surfaced, never swallowed. */
export interface Gap {
  target: string;
  reason: string;
  status: "degraded" | "unavailable" | "failed";
  /** Present when a requested target was substituted by another channel. */
  requestedTarget?: string;
  actualTarget?: string;
}

/** One catalog/sources.v1.json row. */
export interface SourceSpec {
  id: string;
  kind: "engine" | "platform";
  tier: "free" | "keyed" | "verify" | "best-effort";
  /** Whether the upstream supports a server-side time filter. */
  timeRange: boolean;
  /** Per-query result ceiling enforced by the adapter. */
  maxResults: number;
  /** Human-readable endpoint template (documentation + doctor). */
  endpointTemplate: string;
  /** Credential reference name (config.credentialRefs key) when tier === "keyed" / zhihu. */
  credentialRef?: string;
}

/** One catalog/trust.v1.json row set (spec §5 seeds, user-overridable). */
export interface TrustSpec {
  officialDomainPatterns: string[];
  /** Hosts that live ON official domains but host UGC (baike/zhihu-column…) — never A/B. */
  officialDenyHosts?: string[];
  officialAccounts: string[];
  communityDomainPatterns: string[];
  contentFarmPatterns: string[];
  satireDomains: string[];
  clickbaitPatterns: { zh: string[]; en: string[] };
}
