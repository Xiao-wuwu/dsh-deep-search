/** Best-effort-tier platforms (bilibili/weibo/x): every failure becomes a status+note,
 *  never an exception, never a silent empty "ok". X substitutes are labeled (spec §4.2). */
import type { EngineDeps } from "../engines/types.ts";
import type { Platform } from "./registry.ts";
import type { PlatformHit } from "./parsers.ts";
import { HttpError } from "../http/client.ts";
import { QuotaError } from "../engines/types.ts";
import { parseBilibili, parseWeiboHtml, parseXSyndication, type TierResult, type TierStatus } from "./parsers.ts";

export function verifyTierStatus(status: TierStatus): TierStatus {
  return status; // identity on purpose: single mapping point for future normalization
}

/** Per-request result carrying truth about the channel. deep_search consumes these. */
export interface BestEffortPlatform extends Platform {
  searchWithStatus(query: string, opts?: { timeRange?: string; maxResults?: number; signal?: AbortSignal }): Promise<TierResult>;
}

const enc = encodeURIComponent;
const clamp = (n: number | undefined, max: number): number => Math.max(1, Math.min(Math.trunc(n ?? 8), max));

async function guarded(deps: EngineDeps, id: string, fn: () => Promise<TierResult>): Promise<TierResult> {
  if (deps.cooldown.touched(id)) return { status: "unavailable", hits: [], note: `${id} is cooling` };
  if (deps.bucket && !deps.bucket.tryConsume()) return { status: "unavailable", hits: [], note: `local rate limit for ${id}` };
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError && err.isQuota) deps.cooldown.mark(id, 15);
    return { status: "failed", hits: [], note: String((err as Error)?.message ?? err).slice(0, 160) };
  }
}

export function bilibili(deps: EngineDeps): BestEffortPlatform {
  const id = "bilibili";
  return {
    id,
    async searchWithStatus(query, o = {}) {
      const n = clamp(o.maxResults, 15);
      return guarded(deps, id, async () => {
        const res = await deps.http.get(
          `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${enc(query)}&page=1`,
          { target: id, seed: `bili${query}`, headers: { referer: "https://www.bilibili.com" }, signal: o.signal },
        );
        const r = parseBilibili(res.body);
        return { ...r, hits: r.hits.slice(0, n) };
      });
    },
    async search(query, o) {
      return (await this.searchWithStatus(query, o)).hits;
    },
  };
}

export function weibo(deps: EngineDeps): BestEffortPlatform {
  const id = "weibo";
  return {
    id,
    async searchWithStatus(query, o = {}) {
      const n = clamp(o.maxResults, 15);
      return guarded(deps, id, async () => {
        const res = await deps.http.get(`https://s.weibo.com/weibo?q=${enc(query)}`, {
          target: id, seed: `weibo${query}`, signal: o.signal,
        });
        const r = parseWeiboHtml(res.body);
        return { ...r, hits: r.hits.slice(0, n) };
      });
    },
    async search(query, o) {
      return (await this.searchWithStatus(query, o)).hits;
    },
  };
}

export function xBestEffort(deps: EngineDeps, endpoint?: { url: string; token: string }): BestEffortPlatform {
  const id = "x";
  return {
    id,
    async searchWithStatus(query, o = {}) {
      const n = clamp(o.maxResults, 15);
      if (endpoint?.url && endpoint.token) {
        // configured third-party/official endpoint → treated as stable-if-works
        return guarded(deps, id, async () => {
          const res = await deps.http.post(endpoint.url, {
            target: id, seed: `x${query}`,
            headers: { authorization: `Bearer ${endpoint.token}` },
            body: JSON.stringify({ query, max_results: n }),
            signal: o.signal,
          });
          const r = parseXSyndication(res.body); // endpoint expected to return a tweet-list JSON shape
          return { ...r, hits: r.hits.slice(0, n) };
        });
      }
      return guarded(deps, id, async () => {
        const res = await deps.http.get(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${enc(query.replace(/[@\s]/g, "_"))}`, {
          target: id, seed: `x${query}`, signal: o.signal, timeoutMs: 8000,
        });
        const r = parseXSyndication(res.body);
        return { ...r, hits: r.hits.slice(0, n) };
      });
    },
    async search(query, o) {
      const r = await this.searchWithStatus(query, o);
      const hits: PlatformHit[] = r.hits;
      return hits;
    },
  };
}
