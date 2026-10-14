/** Rule extractor (module-3 assist): auto-annotate @accounts, dates, versions,
 *  quoted phrases, action words — so the agent sees entities without parsing text itself. */
import type { Extracted } from "../types.ts";

const ACTION_WORDS = [
  "开源", "发布", "上线", "推出", "同步发布", "预告", "泄露", "传闻", "曝光", "官宣",
  "released", "launch", "open-source", "weights", "announced", "rumor", "leak",
];

function uniq(a: string[]): string[] {
  return [...new Set(a)];
}

export function extractMeta(text: string): Extracted {
  const accounts = uniq([...text.matchAll(/@([A-Za-z0-9_]{2,30})/g)].map((m) => `@${m[1]}`));

  const dates = uniq([
    ...[...text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)].map((m) => m[0]),
    ...[...text.matchAll(/\b(\d{4})\/(\d{1,2})\/(\d{1,2})\b/g)].map((m) => {
      const [, y, mo, d] = m;
      return `${y}-${String(mo)!.padStart(2, "0")}-${String(d)!.padStart(2, "0")}`;
    }),
  ]);

  const versions = uniq(
    [...text.matchAll(/\b([A-Z][\w-]*\d[\w.\-]*[A-Za-z0-9]|\d+[Bb](?:-[A-Za-z]\w*)?)\b/g)]
      .map((m) => m[1]!)
      .filter((t) => /\d/.test(t) && t.length >= 3 && t.length <= 40)
      .filter((t) => !/^\d{1,2}$/.test(t) && !/^\d{4}$/.test(t)),
  ).slice(0, 12);

  const quotes = uniq(
    [...text.matchAll(/["“]([^"“”]{3,80})["”]/g)].map((m) => m[1]!.trim()),
  ).slice(0, 6);

  const lower = text.toLowerCase();
  const actionWords = uniq(ACTION_WORDS.filter((w) => lower.includes(w.toLowerCase())));

  return { accounts, dates, versions, quotes, actionWords };
}
