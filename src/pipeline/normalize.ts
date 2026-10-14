/** Canonical URL + snippet text forms. URL canon is shared with engines (single source). */
export { normalizeUrl } from "../engines/html.ts";

/** Collapse whitespace, trim, lowercase, and pull stray spaces off punctuation (CJK-friendly). */
export function normSnippet(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s+([!?.,，。！？、;；:：])/g, "$1")
    .trim()
    .toLowerCase();
}
