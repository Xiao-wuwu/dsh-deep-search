/** Round-internal + cross-round URL dedupe. `seen` is owned by the research store. */
import type { SourceResult } from "../types.ts";
import { normalizeUrl } from "./normalize.ts";

export interface DedupeResult {
  hits: SourceResult[];
  removed: number;
}

export function dedupeUrls(hits: SourceResult[], seen: Set<string>): DedupeResult {
  const out: SourceResult[] = [];
  const local = new Set<string>();
  let removed = 0;
  for (const h of hits) {
    const canon = normalizeUrl(h.url);
    if (canon === "" || seen.has(canon) || local.has(canon)) {
      removed++;
      continue;
    }
    local.add(canon);
    seen.add(canon);
    out.push(h);
  }
  return { hits: out, removed };
}
