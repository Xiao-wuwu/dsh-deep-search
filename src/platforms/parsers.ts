/** Platform JSON parsers — pure, fixture-testable. Honesty discipline: upstream-absent
 *  fields are OMITTED (never 0/""); an explicit 0/"" from upstream is kept as-is. */

export interface PlatformHit {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  author?: string;
  votes?: number;
  comments?: number;
}

const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
function isoDate(raw: unknown): string | undefined {
  if (typeof raw === "number" && raw > 0) return new Date(raw * 1000).toISOString().slice(0, 10);
  if (typeof raw === "string" && raw.length >= 10) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
    return m ? m[1] : undefined;
  }
  return undefined;
}
function jsonOf(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}
type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v !== null && typeof v === "object" && !Array.isArray(v) ? v as Json : undefined);
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];

export function parseGithub(text: string): PlatformHit[] {
  const j = obj(jsonOf(text));
  return arr(j?.items).map((raw) => {
    const it = obj(raw) ?? {};
    return {
      title: clean(it.full_name),
      url: clean(it.html_url),
      snippet: clean(it.description),
      ...(isoDate(it.updated_at) !== undefined ? { date: isoDate(it.updated_at) } : {}),
      ...(clean(obj(it.owner)?.login) !== "" ? { author: clean(obj(it.owner)?.login) } : {}),
    };
  }).filter((h) => h.url !== "");
}

export function parseHackernews(text: string): PlatformHit[] {
  const j = obj(jsonOf(text));
  return arr(j?.hits).map((raw) => {
    const it = obj(raw) ?? {};
    const url = clean(it.url) || `https://news.ycombinator.com/item?id=${clean(it.objectID)}`;
    const points = num(it.points);
    const comments = num(it.num_comments);
    const snip = it.story_text ?? it.comment_text ?? obj(it._snippetResult)?.value;
    return {
      title: clean(it.title) || "(untitled)",
      url,
      snippet: clean(snip),
      ...(isoDate(it.created_at) !== undefined ? { date: isoDate(it.created_at) } : {}),
      ...(clean(it.author) !== "" ? { author: clean(it.author) } : {}),
      ...(points !== undefined ? { votes: points } : {}),
      ...(comments !== undefined ? { comments } : {}),
    };
  }).filter((h) => h.url !== "" && h.title !== "(untitled)");
}

export function parseReddit(text: string): PlatformHit[] {
  const j = obj(jsonOf(text));
  const children = arr(obj(j?.data)?.children);
  return children.map((raw) => {
    const d = obj(obj(raw)?.data) ?? {};
    const permalink = clean(d.permalink);
    if (permalink === "") return null; // no link → no citable result (dropped, never fabricated URL)
    const score = num(d.score);
    const nc = num(d.num_comments);
    return {
      title: clean(d.title) || "(untitled)",
      url: permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`,
      snippet: clean(d.selftext).slice(0, 280),
      ...(isoDate(d.created_utc) !== undefined ? { date: isoDate(d.created_utc) } : {}),
      ...(clean(d.author) !== "" ? { author: clean(d.author) } : {}),
      ...(score !== undefined ? { votes: score } : {}),
      ...(nc !== undefined ? { comments: nc } : {}),
    };
  }).filter((h): h is PlatformHit => h !== null);
}

export function parseStackoverflow(text: string): PlatformHit[] {
  const j = obj(jsonOf(text));
  return arr(j?.items).map((raw) => {
    const it = obj(raw) ?? {};
    const score = num(it.score);
    const answers = num(it.answer_count);
    return {
      title: clean(it.title),
      url: clean(it.link),
      snippet: clean(it.excerpt ?? it.body_markdown).slice(0, 280),
      ...(isoDate(it.creation_date) !== undefined ? { date: isoDate(it.creation_date) } : {}),
      ...(score !== undefined ? { votes: score } : {}),
      ...(answers !== undefined ? { comments: answers } : {}),
    };
  }).filter((h) => h.url !== "");
}

export function parseWikipedia(text: string): PlatformHit[] {
  const j = obj(jsonOf(text));
  const pages = obj(obj(j?.query)?.pages) ?? {};
  const entries = Object.values(pages)
    .map((raw) => obj(raw) ?? {})
    .filter((p) => typeof p.title === "string" && typeof p.extract === "string");
  entries.sort((a, b) => (num(a.index) ?? 0) - (num(b.index) ?? 0));
  return entries.map((p) => ({
    title: clean(p.title),
    url: clean(p.url) || `https://en.wikipedia.org/wiki/${encodeURIComponent(clean(p.title)).replace(/%20/g, "_")}`,
    snippet: clean(p.extract).slice(0, 280),
  }));
}

export function parseNpm(text: string): PlatformHit[] {
  const j = obj(jsonOf(text));
  return arr(j?.objects).map((raw) => {
    const o = obj(raw) ?? {};
    const pkg = obj(o.package) ?? {};
    const name = clean(pkg.name);
    return {
      title: `${name}${clean(pkg.version) ? ` ${pkg.version}` : ""}`,
      url: name ? `https://www.npmjs.com/package/${name}` : "",
      snippet: clean(pkg.description),
      ...(isoDate(pkg.date) !== undefined ? { date: isoDate(pkg.date) } : {}),
      ...(clean(obj(pkg.publisher)?.username) !== "" ? { author: clean(obj(pkg.publisher)?.username) } : {}),
    };
  }).filter((h) => h.url !== "");
}

export function parseHuggingface(text: string): PlatformHit[] {
  const list = arr(jsonOf(text));
  return list.map((raw) => {
    const it = obj(raw) ?? {};
    const id = clean(it.modelId ?? it.id);
    const dl = num(it.downloads);
    return {
      title: id || clean(it.name) || "(model)",
      url: id ? `https://huggingface.co/${id}` : "",
      snippet: clean(it.tagText ?? (arr(it.tags).slice(0, 4).join(", "))),
      ...(isoDate(it.lastModified) !== undefined ? { date: isoDate(it.lastModified) } : {}),
      ...(clean(it.author) !== "" ? { author: clean(it.author) } : {}),
      ...(dl !== undefined ? { votes: dl } : {}),
    };
  }).filter((h) => h.url !== "");
}

export function parseModelscope(text: string): PlatformHit[] {
  const j = obj(jsonOf(text));
  const env = obj(j?.Data) ?? obj(j?.data) ?? j ?? {};
  const list = arr(env.Model ?? env.models ?? env.Items ?? env.items);
  return list.map((raw) => {
    const it = obj(raw) ?? {};
    const id = clean(it.Id ?? it.id ?? it.Name);
    return {
      title: clean(it.Name ?? it.name) || id,
      url: id ? `https://www.modelscope.cn/models/${id}` : "",
      snippet: clean(it.Description ?? it.description),
      ...(isoDate(it.LastModifiedTime ?? it.last_modified_time) !== undefined ? { date: isoDate(it.LastModifiedTime ?? it.last_modified_time) } : {}),
      ...(num(it.Downloads) !== undefined ? { votes: num(it.Downloads) } : {}),
    };
  }).filter((h) => h.url !== "");
}

export function parseV2ex(text: string): PlatformHit[] {
  return arr(jsonOf(text)).map((raw) => {
    const it = obj(raw) ?? {};
    const replies = num(it.replies);
    return {
      title: clean(it.title),
      url: clean(it.url),
      snippet: clean(it.content).slice(0, 280),
      ...(isoDate(it.created) !== undefined ? { date: isoDate(it.created) } : {}),
      ...(clean(obj(it.member)?.username) !== "" ? { author: clean(obj(it.member)?.username) } : {}),
      ...(replies !== undefined ? { comments: replies } : {}),
    };
  }).filter((h) => h.url !== "");
}

export function parseZhihu(text: string): PlatformHit[] {
  const j = obj(jsonOf(text));
  const env = obj(j?.data) ?? j ?? {};
  const items = arr(env.items ?? env.Items);
  return items.map((raw) => {
    const it = obj(raw) ?? {};
    const votes = num(it.voteup_count ?? it.VoteUpCount);
    const cm = num(it.comment_count ?? it.CommentCount);
    return {
      title: clean(it.title ?? it.Title) || "(无标题)",
      url: clean(it.url ?? it.Url),
      snippet: clean(it.excerpt ?? it.Excerpt ?? it.content_text).slice(0, 280),
      ...(isoDate(it.created_time ?? it.CreatedTime) !== undefined ? { date: isoDate(it.created_time ?? it.CreatedTime) } : {}),
      ...(clean(obj(it.author)?.name ?? it.AuthorName) !== "" ? { author: clean(obj(it.author)?.name ?? it.AuthorName) } : {}),
      ...(votes !== undefined ? { votes } : {}),
      ...(cm !== undefined ? { comments: cm } : {}),
    };
  }).filter((h) => h.url !== "");
}
