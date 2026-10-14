/** Near-duplicate clustering: title+snippet tokens → Jaccard ≥ 0.55 via union-find.
 *  Latin words split on \W; CJK runs expanded to character bigrams (no segmenter dep). */
import type { SourceResult } from "../types.ts";

export interface Cluster {
  clusterId: string;
  size: number;
  memberIds: string[]; // source URLs
  trustMix: Record<string, number>;
  dateRange?: [string, string];
  topTitle: string;
  independentDomains: number;
}

const THRESHOLD = 0.55;

export function tokenize(text: string): Set<string> {
  const toks = new Set<string>();
  const lower = text.toLowerCase();
  // Latin/word tokens
  for (const w of lower.split(/[^\p{L}\p{N}]+/u)) {
    if (w.length >= 2 && !/[\u4e00-\u9fff]/.test(w)) toks.add(w);
  }
  // CJK runs → bigrams (single chars too, so short runs still contribute)
  const cjkRuns = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) toks.add(run);
    for (let i = 0; i + 1 < run.length; i++) toks.add(run.slice(i, i + 2));
  }
  return toks;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (large.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Assigns clusterId/clusterSize onto each hit (mutates) and returns the cluster list. */
export function clusterHits(hits: SourceResult[]): Cluster[] {
  if (hits.length === 0) return [];
  const tokens = hits.map((h) => tokenize(`${h.title} ${h.snippet}`));
  const parent = hits.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const union = (x: number, y: number): void => {
    const rx = find(x), ry = find(y);
    if (rx !== ry) parent[ry] = rx;
  };
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      if (jaccard(tokens[i]!, tokens[j]!) >= THRESHOLD) union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  hits.forEach((_, i) => {
    const r = find(i);
    const arr = groups.get(r) ?? [];
    arr.push(i);
    groups.set(r, arr);
  });

  const clusters: Cluster[] = [];
  let n = 0;
  for (const idxs of groups.values()) {
    const clusterId = `c${n++}`;
    const trustMix: Record<string, number> = {};
    const domains = new Set<string>();
    const dates: string[] = [];
    let bestTitle = "";
    let bestVotes = -1;
    for (const i of idxs) {
      const h = hits[i]!;
      h.clusterId = clusterId;
      h.clusterSize = idxs.length;
      trustMix[h.trustRank] = (trustMix[h.trustRank] ?? 0) + 1;
      try { domains.add(new URL(h.url).hostname.replace(/^www\./, "")); } catch { /* ignore */ }
      if (h.date) dates.push(h.date);
      const v = h.votes ?? 0;
      if (v > bestVotes) { bestVotes = v; bestTitle = h.title; }
    }
    if (bestTitle === "") bestTitle = hits[idxs[0]!]!.title;
    dates.sort();
    const cluster: Cluster = {
      clusterId,
      size: idxs.length,
      memberIds: idxs.map((i) => hits[i]!.url),
      trustMix,
      topTitle: bestTitle,
      independentDomains: domains.size,
    };
    if (dates.length > 0) cluster.dateRange = [dates[0]!, dates[dates.length - 1]!];
    clusters.push(cluster);
  }
  return clusters.sort((a, b) => b.size - a.size);
}
