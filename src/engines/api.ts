/** JSON API response parsers (searxng / tavily / firecrawl / serper / bocha / exa), pure + fixture-testable. */
import type { EngineHit } from "./types.ts";
import { normalizeUrl } from "./html.ts";

const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** "2026-10-10T00:00:00Z" / "2026-10-10" → "2026-10-10"; anything non-ISO stays as-is (absent → undefined). */
function isoDate(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return m ? m[1] : raw;
}

function jsonOf(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // malformed → caller returns [] (honest: no results, no crash)
  }
}

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json | undefined => (v !== null && typeof v === "object" ? (v as Json) : undefined);
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function parseSearxngJson(text: string): EngineHit[] {
  const json = asObj(jsonOf(text));
  const hits: EngineHit[] = [];
  for (const item of asArr(json?.results)) {
    const it = asObj(item);
    const url = normalizeUrl(clean(it?.url));
    if (!url) continue;
    const date = isoDate(it?.publishedDate);
    hits.push({
      title: clean(it?.title) || "(无标题)",
      url,
      snippet: clean(it?.content),
      ...(date !== undefined ? { date } : {}),
    });
  }
  return hits;
}

/** kind-specific mapping for the keyed / quota engines. */
export function parseApiJson(text: string, kind: "tavily" | "firecrawl" | "serper" | "bocha" | "exa"): EngineHit[] {
  const json = asObj(jsonOf(text));
  const raw: unknown[] =
    kind === "firecrawl" ? asArr(asObj(json?.data)?.web)
    : kind === "serper" ? asArr(json?.organic)
    : kind === "bocha" ? asArr(asObj(asObj(json?.data)?._embedded)?.items)
    : asArr(json?.results); // tavily / exa
  const hits: EngineHit[] = [];
  for (const item of raw) {
    const it = asObj(item);
    const url = normalizeUrl(
      kind === "serper" ? clean(it?.link) : clean(it?.url),
    );
    if (!url) continue;
    const snippet =
      kind === "bocha" ? clean(it?.summary)
      : kind === "exa" ? clean(it?.text)
      : clean(it?.content ?? it?.snippet);
    const date = isoDate(it?.published_date ?? it?.publishedDate ?? it?.date);
    const author = clean(it?.authorName ?? it?.author);
    hits.push({
      title: clean(it?.title) || "(无标题)",
      url,
      snippet,
      ...(date !== undefined ? { date } : {}),
      ...(author !== "" ? { author } : {}),
    });
  }
  return hits;
}
