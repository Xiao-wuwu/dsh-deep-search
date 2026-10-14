/** HTML engine response parsers (bing / ddg / mojeek), pure + fixture-testable. */
import { parse } from "node-html-parser";
import type { EngineHit } from "./types.ts";

const clean = (s: string | null | undefined): string =>
  (s ?? "").replace(/\s+/g, " ").trim();

/** Absolute URL + strip tracking params (utm*, fbclid, gclid) & fragment. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw, "https://invalid.local");
    if (u.hostname === "invalid.local") return "";
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm|utm_.+|sa|source|fbclid|gclid|mc_[a-z]+)$/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    let out = u.toString();
    if (out.endsWith("/") && u.search === "" && u.hash === "") out = out.slice(0, -1);
    return out;
  } catch {
    return "";
  }
}

/** bing ck/a redirect: u=a1<base64url(target)> */
function decodeBingTarget(href: string): string {
  try {
    const u = new URL(href);
    const a = u.searchParams.get("u");
    if (a?.startsWith("a1")) {
      const t = Buffer.from(a.slice(2), "base64url").toString("utf8");
      if (/^https?:\/\//.test(t)) return t;
    }
  } catch {
    /* fall through */
  }
  return href;
}

/** ddg l/?uddg=<encoded target> redirect */
function decodeDdgTarget(href: string): string {
  try {
    const u = new URL(href);
    if (u.hostname.endsWith("duckduckgo.com")) {
      const g = u.searchParams.get("uddg");
      if (g && /^https?:\/\//.test(g)) return g;
    }
  } catch {
    /* fall through */
  }
  return href;
}

/** Parse RSS/Atom XML → hits. bing's `format=rss` endpoint (learned from
 *  dsh-web-search-pro: HTML scraping of Bing is fragile to 302+gzip+bot-checks;
 *  the RSS endpoint is anonymous, stable, and already carries date/description). */
export function parseRss(xml: string, count = 20): EngineHit[] {
  const hits: EngineHit[] = [];
  const itemRe = /<(item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  const strip = (s: string): string => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x?[\da-f]+;?/gi, " ").replace(/\s+/g, " ").trim();
  const grab = (tag: string, block: string): string | undefined => {
    const t = new RegExp("<" + tag + "(?:[^>]*)>([\\s\\S]*?)</" + tag + ">", "i").exec(block);
    return t ? strip(t[1]!) : undefined;
  };
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[2] ?? "";
    const linkMatch = /<link[^>]*href="([^"]+)"/i.exec(block) ?? /<link[^>]*>([\s\S]*?)<\/link>/i.exec(block) ?? /<id[^>]*>([\s\S]*?)<\/id>/i.exec(block);
    const url = normalizeUrl(linkMatch ? strip(linkMatch[1] ?? linkMatch[2] ?? "") : "");
    if (!url) continue;
    const title = grab("title", block);
    const snippet = grab("description", block) ?? grab("summary", block) ?? grab("content", block);
    const pub = grab("pubDate", block) ?? grab("published", block) ?? grab("updated", block);
    const date = pub ? isoDateFromRss(pub) : undefined;
    hits.push({
      title: title && title.length > 1 ? title : "(无标题)",
      url,
      snippet: snippet ? snippet.slice(0, 280) : "",
      ...(date ? { date } : {}),
    });
    if (hits.length >= count) break;
  }
  return hits;
}

/** "Wed, 09 Oct 2026 …" / ISO → YYYY-MM-DD; unparseable → undefined (never fabricate). */
function isoDateFromRss(raw: string): string | undefined {
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString().slice(0, 10);
}

export function parseBing(html: string): EngineHit[] {
  const root = parse(html);
  const hits: EngineHit[] = [];
  for (const li of root.querySelectorAll("li.b_algo")) {
    if (li.classList.contains("b_ans")) continue;
    const a = li.querySelector("h2 a");
    if (!a) continue;
    const url = normalizeUrl(decodeBingTarget(a.getAttribute("href") ?? ""));
    if (!url) continue;
    hits.push({
      title: clean(a.textContent),
      url,
      snippet: clean(li.querySelector(".b_caption p, figcaption, p")?.textContent),
    });
  }
  return hits;
}

export function parseDdg(html: string): EngineHit[] {
  const root = parse(html);
  const hits: EngineHit[] = [];
  for (const body of root.querySelectorAll(".result__body")) {
    const parent = body.closest(".result");
    if (parent && /result--ad|result--banner/.test(parent.getAttribute("class") ?? "")) continue;
    const a = body.querySelector("a.result__a");
    if (!a) continue;
    const url = normalizeUrl(decodeDdgTarget(a.getAttribute("href") ?? ""));
    if (!url) continue;
    hits.push({
      title: clean(a.textContent),
      url,
      snippet: clean(body.querySelector(".result__snippet")?.textContent),
    });
  }
  return hits;
}

export function parseMojeek(html: string): EngineHit[] {
  const root = parse(html);
  const hits: EngineHit[] = [];
  for (const li of root.querySelectorAll("ul.results-standard > li, ul.results-group > li")) {
    const a = li.querySelector("h3 a, h2 a");
    if (!a) continue;
    const url = normalizeUrl(a.getAttribute("href") ?? "");
    if (!url) continue;
    hits.push({
      title: clean(a.textContent),
      url,
      snippet: clean(li.querySelector("p.s")?.textContent),
    });
  }
  return hits;
}
