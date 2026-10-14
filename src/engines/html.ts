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
      if (/^(utm_|sa|source|fbclid|gclid|mc_[a-z]+)$/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase();
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
